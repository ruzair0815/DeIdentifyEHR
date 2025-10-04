# De-Identification of PHI in Electronic Health Records (EHR)

## Overview
This project is a **Python-based de-identification tool** designed to automatically detect and remove Protected Health Information (PHI) from Electronic Health Records (EHR).  
It ensures compliance with **HIPAA Safe Harbor** guidelines by identifying and anonymizing sensitive patient data while preserving the usefulness of the records for research and analytics.

The project was built using:
- **Python**
- **Node.js**
- **React**
- **MongoDB**
- **AWS S3** 

---

## Features
- **Automated PHI Detection**: Identifies sensitive information such as names, dates, addresses, phone numbers, and more.
- **HIPAA Safe Harbor Compliance**: Removes or masks 18 HIPAA-specified identifiers.
- **Multiple Input Formats**: Works with structured and semi-structured EHR data.
- **Cloud Integration**: Uses AWS S3 for secure upload/download of EHR files.
- **Database Support**: Stores anonymized records in MongoDB for easy querying and retrieval.
- **Batch Processing**: Supports single-file and bulk de-identification.

