import React, { useState, useRef } from "react";
import Input from "@mui/joy/Input";
import Button from "@mui/material/Button";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import axios from "axios";
import "./styles.css";

function Home() {
  const [fileName, setFileName] = useState("");
  const [deidentifiedData, setDeidentifiedData] = useState(null);
  const [recordId, setRecordId] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);

  // Handle file selection
  const handleChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setFileName(file.name);
      setDeidentifiedData(null);
      setRecordId(null);
      setError(null);
    }
  };

  // Handle file upload
  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!fileInputRef.current?.files[0]) {
      setError("Please select a file to upload");
      return;
    }

    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", fileInputRef.current.files[0]);

    try {
      const response = await axios.post("http://localhost:8000/upload", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      setDeidentifiedData(response.data.deidentifiedFile);
      setRecordId(response.data.recordId);
      console.log("Upload successful:", response.data);
    } catch (err) {
      setError(
        err.response?.data?.error || "An error occurred while uploading the file"
      );
      console.error("Upload error:", err);
    } finally {
      setLoading(false);
    }
  };

  // Handle download of de-identified file
  const handleDownload = async () => {
    if (!deidentifiedData) {
      setError("No de-identified data available to download");
      return;
    }
    try {
      const encodedFileName = encodeURIComponent(deidentifiedData); // Encode the filename
      const response = await axios.get(
        `http://localhost:8000/download/${encodedFileName}`,
        {
          responseType: "blob",
        }
      );
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", deidentifiedData.split("/").pop()); // Use the unencoded filename for download
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error("Download error:", err);
      setError(
        "Failed to download the de-identified file: " +
          (err.response?.data?.error || err.message)
      );
    }
  };

  // Handle re-identification
  const handleReidentify = async () => {
    if (!recordId) {
      setError("No record ID available. Please upload a file first.");
      return;
    }
    try {
      const response = await axios.post(
        `http://localhost:8000/reidentify/${recordId}`,
        null, // No body needed for POST
        {
          responseType: "blob", // Expect a file response
        }
      );
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `reidentified-${recordId}.txt`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setError(null); // Clear any previous errors
      console.log("Re-identification successful for recordId:", recordId);
    } catch (err) {
      console.error("Re-identify error:", err);
      setError(
        "Failed to re-identify the record: " +
          (err.response?.status ? `${err.response.status} - ` : "") +
          (err.response?.data?.error || err.message)
      );
    }
  };

  return (
    <form onSubmit={handleFileUpload}>
      <Input
        placeholder="Upload documents here for deidentification… "
        variant="solid"
        className="inputfield"
        value={fileName}
        readOnly
      />
      <hr style={{ width: '100%', margin: '20px 0' }} /> {/* Added by Zepeng Yu: Insert a line break to fix layout and ensure upload icon displays properly */}
      <AttachFileIcon
        className="icon"
        onClick={() => fileInputRef.current?.click()}
        sx={{                       
          fontSize: 40,
          color: "white",
          position: "absolute",
          top: "44%",
          left: "22%",
          transform: "translate(-50%, -50%)",
          cursor: "pointer",
         }}// Added by Zepeng Yu: Applied style settings to properly position and display the upload icon
      />
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleChange}
        style={{ display: "none" }}
      />
      <Button
        variant="contained"
        className="button"
        sx={{
          backgroundColor: "primary.main",
          position: "absolute",
          top: "48%",
          right: "27.5%",
          borderRadius: "20px",
          padding: 1.5,
          "&hover": { backgroundColor: "secondary.dark" },
        }}
        type="submit"
        disabled={loading}
      >
        {loading ? "Uploading..." : "Submit for Deidentification"}
      </Button>

      {/* Display error message if any */}
      {error && (
        <div style={{ marginTop: "20px", color: "red" }}>{error}</div>
      )}

      {/* Display buttons to download de-identified and re-identified files after upload */}
      {deidentifiedData && recordId && (
        <div style={{ marginTop: "65px", marginLeft: "760px" }}>
          <Button
            variant="contained"
            sx={{ marginRight: 2 }}
            onClick={handleDownload}
            className="download"
          >
            Download Deidentified Data
          </Button>
          <Button
            variant="contained"
            color="secondary"
            onClick={handleReidentify}
            className="download"
          >
            Re-identify Record
          </Button>
        </div>
      )}
    </form>
  );
}

export default Home;