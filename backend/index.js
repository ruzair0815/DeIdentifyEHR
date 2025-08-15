// Import required modules using ES Modules
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import multer from "multer";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import fernet from "fernet";
import os from "os";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  "S3_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "S3_BUCKET",
  "MONGOURI",
  "PORT",
];

const missingEnvVars = requiredEnvVars.filter((varName) => !process.env[varName]);
if (missingEnvVars.length > 0) {
  console.error(
    "Error: Missing required environment variables:",
    missingEnvVars.join(", ")
  );
  process.exit(1);
}

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Schema for storing de-identified file metadata
const patientSchema = new mongoose.Schema({
  recordId: String,
  fileReference: String,
  encryptedPii: String,
  encryptionKey: String,
});
const PatientModel = mongoose.model("Patient", patientSchema);

// Configure AWS S3 Client
const s3Client = new S3Client({
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Configure Multer to store uploaded files in memory
const upload = multer({
  storage: multer.memoryStorage(),
});

// Helper function to convert S3 stream to string
const streamToString = (stream) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
};

// Helper function to escape regex special characters
const escapeRegExp = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// Route to handle file upload and de-identification
app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const inputBuffer = req.file.buffer;
  const tempDir = os.tmpdir();
  const tempInputFile = path.join(tempDir, `temp-${Date.now()}-${req.file.originalname}`);
  const outputFilePath = path.join(
    process.cwd(),
    `deidentified-${Date.now()}-${req.file.originalname}`
  );

  try {
    // Write the buffer to a temporary file
    fs.writeFileSync(tempInputFile, inputBuffer);
    console.log(`Temporary input file written to: ${tempInputFile}`);

    // Upload the original file to S3 temporarily for processing
    const originalS3Key = `original/${Date.now()}-${req.file.originalname}`;
    const uploadOriginalParams = {
      Bucket: process.env.S3_BUCKET,
      Key: originalS3Key,
      Body: inputBuffer,
    };
    await s3Client.send(new PutObjectCommand(uploadOriginalParams));
    console.log(`Original file uploaded to S3: ${originalS3Key}`);

    // Call the Python script to de-identify the file
    const pythonScriptPath = path.join(process.cwd(), "redact_phi.py");
    console.log(`Running Python script: ${pythonScriptPath}`);
    const pythonProcess = spawn("python3", [
      pythonScriptPath,
      tempInputFile,
      outputFilePath,
    ]);

    let pythonOutput = "";
    let pythonError = "";

    pythonProcess.stdout.on("data", (data) => {
      const output = data.toString();
      pythonOutput += output;
      const lines = output.split("\n");
      const filteredLines = lines.filter(
        (line) => !line.startsWith("Decrypted Removed Items (for debug):")
      );
      const filteredOutput = filteredLines.join("\n");
      if (filteredOutput.trim()) {
        console.log(`Python output: ${filteredOutput}`);
      }
    });

    pythonProcess.stderr.on("data", (data) => {
      pythonError += data.toString();
      console.error(`Python error: ${data}`);
    });

    pythonProcess.on("close", async (code) => {
      // Clean up the temporary input file
      if (fs.existsSync(tempInputFile)) {
        fs.unlinkSync(tempInputFile);
        console.log(`Cleaned up temporary input file: ${tempInputFile}`);
      }

      if (code === 0) {
        // Parse the Python script output
        let recordId, encryptedPii, encryptionKey;
        const lines = pythonOutput.split("\n");
        for (const line of lines) {
          if (line.startsWith("Record ID: ")) {
            recordId = line.replace("Record ID: ", "").trim();
          } else if (line.startsWith("Encrypted Removed Items: ")) {
            encryptedPii = line.replace("Encrypted Removed Items: ", "").trim();
          } else if (line.startsWith("Encryption Key: ")) {
            encryptionKey = line.replace("Encryption Key: ", "").trim();
          }
        }

        if (!recordId || !encryptedPii || !encryptionKey) {
          console.error("Failed to parse Python script output:", pythonOutput);
          throw new Error("Failed to parse Python script output");
        }
        console.log(`Parsed from Python: recordId=${recordId}, encryptedPii=${encryptedPii}, encryptionKey=${encryptionKey}`);

        // Read the de-identified content
        const deidentifiedContent = fs.readFileSync(outputFilePath, "utf8");
        console.log(`De-identified file created at: ${outputFilePath}`);

        // Upload the de-identified file to S3
        const deidentifiedS3Key = `deidentified/deidentified-${Date.now()}-${req.file.originalname}`;
        const uploadDeidentifiedParams = {
          Bucket: process.env.S3_BUCKET,
          Key: deidentifiedS3Key,
          Body: deidentifiedContent,
        };
        await s3Client.send(new PutObjectCommand(uploadDeidentifiedParams));
        console.log(`De-identified file uploaded to S3: ${deidentifiedS3Key}`);

        // Store metadata in MongoDB
        const patientData = {
          recordId: recordId,
          fileReference: deidentifiedS3Key,
          encryptedPii: encryptedPii,
          encryptionKey: encryptionKey,
        };
        const savedPatient = await PatientModel.create(patientData);
        console.log("Saved patient data to MongoDB:", savedPatient);

        // Clean up temporary output file
        if (fs.existsSync(outputFilePath)) {
          fs.unlinkSync(outputFilePath);
          console.log(`Cleaned up temporary output file: ${outputFilePath}`);
        }

        res.json({
          message: "File de-identified and stored successfully",
          deidentifiedFile: deidentifiedS3Key,
          recordId: recordId,
        });
      } else {
        console.error(`Python process failed with code ${code}, error: ${pythonError}`);
        res.status(500).json({ error: "De-identification failed", details: pythonError });
      }
    });
  } catch (err) {
    console.error(`Error during upload: ${err.message}`);
    // Clean up if temporary files exist
    if (fs.existsSync(tempInputFile)) {
      fs.unlinkSync(tempInputFile);
    }
    if (fs.existsSync(outputFilePath)) {
      fs.unlinkSync(outputFilePath);
    }
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// Route to download the de-identified file
app.get("/download/:filename", async (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  const s3Params = {
    Bucket: process.env.S3_BUCKET,
    Key: filename,
  };

  try {
    console.log(`Downloading file from S3: ${filename}`);
    const getObjectCommand = new GetObjectCommand(s3Params);
    const s3Response = await s3Client.send(getObjectCommand);
    s3Response.Body.pipe(res);
    res.setHeader("Content-Disposition", `attachment; filename="${filename.split("/").pop()}"`);
    res.setHeader("Content-Type", "text/plain");
  } catch (err) {
    console.error(`Error downloading file: ${err.message}`);
    res.status(500).json({ error: "File not found in S3", details: err.message });
  }
});

// Route to retrieve all patient records (for debugging)
app.get("/patients", async (req, res) => {
  try {
    console.log("Fetching all patient records from MongoDB");
    const patients = await PatientModel.find().lean();
    if (!patients || patients.length === 0) {
      console.log("No patient records found in MongoDB");
      return res.status(404).json({ message: "No patient records found" });
    }
    console.log(`Retrieved ${patients.length} patient records`);
    res.json({
      message: "Patient records retrieved successfully",
      data: patients,
    });
  } catch (err) {
    console.error(`Error retrieving patient records: ${err.message}`);
    res.status(500).json({ error: "Failed to retrieve patient records", details: err.message });
  }
});

// Route to re-identify the record (fixed version)
app.post("/reidentify/:recordId", async (req, res) => {
  const recordId = req.params.recordId;
  console.log(`Re-identification request for recordId: ${recordId}`);

  try {
    // 1. Find the record in MongoDB
    const patient = await PatientModel.findOne({ recordId }).lean();
    if (!patient) {
      return res.status(404).json({ 
        error: "Record not found", 
        details: `No record with ID: ${recordId}` 
      });
    }

    // 2. Verify required fields exist
    if (!patient.fileReference || !patient.encryptedPii || !patient.encryptionKey) {
      return res.status(400).json({
        error: "Incomplete record",
        details: "Missing required fields in patient record"
      });
    }

    // 3. Get the de-identified file from S3
    const s3Params = {
      Bucket: process.env.S3_BUCKET,
      Key: patient.fileReference
    };
    
    let cleanedContent;
    try {
      const { Body } = await s3Client.send(new GetObjectCommand(s3Params));
      cleanedContent = await streamToString(Body);
      if (typeof cleanedContent !== 'string') {
        throw new Error('S3 content is not a string');
      }
    } catch (s3Err) {
      return res.status(404).json({
        error: "File not found in S3",
        details: s3Err.message
      });
    }

    // 4. Decrypt the PII data
    let removedItems;
    try {
      const secret = new fernet.Secret(patient.encryptionKey);
      const token = new fernet.Token({
        secret,
        token: patient.encryptedPii,
        ttl: 0
      });
      const decrypted = token.decode();
      removedItems = decrypted.split('\n').filter(Boolean);
      console.log('Decrypted items:', removedItems);
    } catch (decryptErr) {
      return res.status(500).json({
        error: "Decryption failed",
        details: decryptErr.message
      });
    }

    // 5. Re-identify the content
    let reidentifiedContent = cleanedContent;
    const placeholders = [
      '*name*', '*dob*', '*mrn*', '*ssn*', '*address*',
      '*phone*', '*email*', '*hospital*', '*allergy*',
      '*labs*', '*account*'
    ];

    // Replace placeholders in order
    for (let i = 0; i < Math.min(removedItems.length, placeholders.length); i++) {
      const placeholder = placeholders[i];
      const value = removedItems[i];
      reidentifiedContent = reidentifiedContent.replace(
        new RegExp(escapeRegExp(placeholder), 'g'),
        value
      );
    }

    // 6. Send the re-identified content
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="reidentified-${recordId}.txt"`);
    res.send(reidentifiedContent);

  } catch (err) {
    console.error(`Re-identification error: ${err.stack}`);
    res.status(500).json({
      error: "Internal server error",
      details: err.message
    });
  }
});

// Connect to MongoDB and start the server
(async () => {
  try {
    await mongoose.connect(process.env.MONGOURI, {
      serverSelectionTimeoutMS: 30000,
    });
    console.log("Database Connected");

    const PORT = process.env.PORT || 8000;
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error(`MongoDB connection error: ${err.message}`);
    process.exit(1);
  }
})();