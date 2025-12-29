# Shipping Document Extractor Demo

A simple Node.js demo application that extracts structured data from shipping documents (Invoice/HBL/MBL) using OpenAI Vision models.

## Setup

1. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

2. **Configure OpenAI API Key:**
   - Create a `.env` file in the project root
   - Add your OpenAI API key:
   ```bash
   OPENAI_API_KEY=sk-your-key-here
   ```

3. **Install system dependencies for PDF conversion (optional, only if using PDFs):**
   
   **On macOS:**
   ```bash
   brew install poppler
   ```
   
   **On Ubuntu/Debian:**
   ```bash
   sudo apt-get install poppler-utils
   ```
   
   **Note:** PDF conversion requires poppler. If you only use image files, you can skip this step.

## Usage

```bash
npm start
```

The server will start on `http://localhost:3000` (or the port specified in PORT environment variable).

### Using the Web Interface

1. Open your browser and navigate to `http://localhost:3000`
2. **Upload a file:**
   - Click "Choose File" and select a PDF or image file (PNG, JPG, JPEG, GIF, WEBP)
   - The file will be uploaded and stored in the `uploads/` folder
3. **Extract data:**
   - Click the "Extract Data from Document" button
   - For PDFs: The PDF will be converted to images first, then processed
   - For images: The image will be sent directly to OpenAI Vision API
   - Results will be displayed in a beautiful UI

### API Endpoint

You can also call the API directly:

```bash
curl -X POST http://localhost:3000/api/extract
```

Returns JSON with the extracted data.

## Output

- **Web UI**: Beautiful, interactive interface displaying all extracted data
- **API Response**: JSON format with complete structured data
- **Console**: Server logs for debugging

## Requirements

- Node.js (ESM support)
- OpenAI API key with access to vision models
- Image file to process (PNG, JPG, JPEG, GIF, or WEBP)

## Notes

- This is a DEMO application only
- File uploads are supported (stored in `uploads/` folder)
- PDFs are automatically converted to images using pdf-poppler
- No database or authentication
- Images are sent directly to OpenAI Vision API
- Express server serves the frontend and API
- **Supported file formats:**
  - PDF (converted to PNG images)
  - Images: PNG, JPG, JPEG, GIF, WEBP
- **System requirements:**
  - Poppler (for PDF conversion) - install via Homebrew or apt-get
  - Node.js with ESM support

