import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import multer from 'multer';
import pdf from 'pdf-poppler';
import { HBLPROMPT, COMMERCIAL_INVOICE_PROMPT, MBL_PROMPT } from './constants.js';

// Load environment variables
dotenv.config();

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration - Declare constants first
const IMAGE_PATH = "./sample-docs/invoice.png"; // Hardcoded image path (fallback)
const UPLOAD_DIR = "./uploads"; // Directory for uploaded files
const TEMP_IMAGES_DIR = "./temp_images"; // Temporary directory for PDF conversion

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Create upload and temp directories if they don't exist
[UPLOAD_DIR, TEMP_IMAGES_DIR].forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`📁 Created directory: ${fullPath}`);
  }
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, UPLOAD_DIR));
  },
  filename: (req, file, cb) => {
    // Keep original filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit per file
    files: 50 // Maximum 50 files at once
  },
  fileFilter: (req, file, cb) => {
    // Accept PDF and image files
    const allowedTypes = /\.(pdf|png|jpg|jpeg|gif|webp)$/i;
    if (allowedTypes.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, PNG, JPG, JPEG, GIF, and WEBP files are allowed.'));
    }
  }
});

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Function to get prompt based on document type
function getPromptForDocumentType(documentType) {
  switch (documentType?.toUpperCase()) {
    case 'COMMERCIAL_INVOICE':
    case 'INVOICE':
      return COMMERCIAL_INVOICE_PROMPT;
    case 'HBL':
      return HBLPROMPT;
    case 'MBL':
      return MBL_PROMPT;
    default:
      return MBL_PROMPT; // Default fallback
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Read image file and convert to base64
 * @param {string} imagePath - Path to image file
 * @returns {Object} Object with base64 string and MIME type
 */
function imageToBase64(imagePath) {
  // Check if file exists
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image file not found: ${imagePath}`);
  }
  
  const imageBuffer = fs.readFileSync(imagePath);
  
  // Verify it's actually an image file (check file signature/magic bytes)
  // Check PNG: 89 50 4E 47 (PNG signature)
  const isPNG = imageBuffer[0] === 0x89 && 
                imageBuffer[1] === 0x50 && 
                imageBuffer[2] === 0x4E && 
                imageBuffer[3] === 0x47;
  
  // Check JPEG: FF D8 FF
  const isJPEG = imageBuffer[0] === 0xFF && 
                 imageBuffer[1] === 0xD8 && 
                 imageBuffer[2] === 0xFF;
  
  // Check GIF: 47 49 46 38 (GIF8)
  const isGIF = imageBuffer[0] === 0x47 && 
                imageBuffer[1] === 0x49 && 
                imageBuffer[2] === 0x46 && 
                imageBuffer[3] === 0x38;
  
  // Check WEBP: RIFF...WEBP
  const isWEBP = imageBuffer[0] === 0x52 && 
                 imageBuffer[1] === 0x49 && 
                 imageBuffer[2] === 0x46 && 
                 imageBuffer[3] === 0x46 &&
                 imageBuffer[8] === 0x57 && 
                 imageBuffer[9] === 0x45 && 
                 imageBuffer[10] === 0x42 && 
                 imageBuffer[11] === 0x50;
  
  // Determine MIME type from file signature (most reliable)
  let mimeType;
  if (isPNG) {
    mimeType = 'image/png';
  } else if (isJPEG) {
    mimeType = 'image/jpeg';
  } else if (isGIF) {
    mimeType = 'image/gif';
  } else if (isWEBP) {
    mimeType = 'image/webp';
  } else {
    // Fallback to extension if signature doesn't match
    const ext = path.extname(imagePath).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    mimeType = mimeTypes[ext] || 'image/png';
    console.warn(`⚠️  Could not detect image type from signature, using extension: ${ext} -> ${mimeType}`);
  }
  
  const base64 = imageBuffer.toString('base64');
  
  // Verify the detected MIME type matches the file content
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === '.png' && !isPNG) {
    console.warn(`⚠️  Warning: File has .png extension but signature doesn't match PNG format`);
  } else if ((ext === '.jpg' || ext === '.jpeg') && !isJPEG) {
    console.warn(`⚠️  Warning: File has .jpg/.jpeg extension but signature doesn't match JPEG format`);
  } else if (ext === '.gif' && !isGIF) {
    console.warn(`⚠️  Warning: File has .gif extension but signature doesn't match GIF format`);
  }
  
  return { base64, mimeType };
}

/**
 * Convert PDF to images (one per page)
 * @param {string} pdfPath - Path to PDF file
 * @returns {Promise<string[]>} Array of image file paths
 */
async function convertPdfToImages(pdfPath) {
  console.log(`\n📄 Converting PDF to images: ${pdfPath}`);
  
  const tempDir = path.join(__dirname, TEMP_IMAGES_DIR);
  
  // Create temp directory if it doesn't exist
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const options = {
    format: 'png',
    out_dir: tempDir,
    out_prefix: 'page',
    page: null // Convert all pages
  };

  try {
    await pdf.convert(pdfPath, options);
    
    // Get all generated image files, sorted by page number
    const files = fs.readdirSync(tempDir)
      .filter(file => file.startsWith('page') && file.endsWith('.png'))
      .sort((a, b) => {
        // Extract page number from filename (e.g., "page-1.png")
        const numA = parseInt(a.match(/\d+/)?.[0] || 0);
        const numB = parseInt(b.match(/\d+/)?.[0] || 0);
        return numA - numB;
      })
      .map(file => path.join(tempDir, file));

    console.log(`✅ Converted ${files.length} page(s) to images`);
    return files;
  } catch (error) {
    console.error('❌ Error converting PDF:', error);
    throw new Error(`Failed to convert PDF to images: ${error.message}`);
  }
}

/**
 * Merge extracted data from multiple batches
 * @param {Object[]} extractedDataArray - Array of extracted data objects
 * @returns {Object} Merged extracted data
 */
function mergeExtractedData(extractedDataArray) {
  if (extractedDataArray.length === 0) {
    return null;
  }
  
  if (extractedDataArray.length === 1) {
    return extractedDataArray[0];
  }
  
  // Start with the first result
  const merged = JSON.parse(JSON.stringify(extractedDataArray[0]));
  
  // Merge line items from all batches
  merged.line_items = extractedDataArray.flatMap(data => data.line_items || []);
  
  // Update counts
  merged.extraction_confidence = {
    overall: extractedDataArray.length > 0 ? 
      (extractedDataArray.reduce((sum, d) => sum + (d.extraction_confidence?.overall || 0), 0) / extractedDataArray.length) : null,
    line_items: merged.line_items.length
  };
  
  // Combine missing fields (unique)
  const allMissingFields = extractedDataArray.flatMap(data => data.missing_fields || []);
  merged.missing_fields = [...new Set(allMissingFields)];
  
  console.log(`\n📊 Merged ${extractedDataArray.length} batch(es): ${merged.line_items.length} total line items`);
  
  return merged;
}

/**
 * Clean up temporary image files
 * @param {string[]} imagePaths - Array of image file paths to delete
 */
function cleanupTempImages(imagePaths = []) {
  try {
    // Delete specific image files if provided
    imagePaths.forEach(imagePath => {
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    });
    
    // Also clean up the temp directory
    const tempDir = path.join(__dirname, TEMP_IMAGES_DIR);
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      files.forEach(file => {
        if (file.startsWith('page') && file.endsWith('.png')) {
          fs.unlinkSync(path.join(tempDir, file));
        }
      });
    }
  } catch (error) {
    console.warn('⚠️  Warning: Could not clean up temp images:', error.message);
  }
}

/**
 * Check if file is a PDF
 * @param {string} filePath - Path to file
 * @returns {boolean} True if file is a PDF
 */
function isPdfFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.pdf') return false;
  
  // Also check file signature
  try {
    const buffer = fs.readFileSync(filePath, { start: 0, end: 4 });
    // PDF signature: %PDF
    return buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  } catch {
    return false;
  }
}

/**
 * Extract data from image or PDF using OpenAI Vision
 * Handles both single images and PDFs (converts to images first)
 * @param {string} filePath - Path to image or PDF file
 * @returns {Promise<Object>} Extracted structured data
 */
async function extractDataWithOpenAI(filePaths, batchSize = 5, documentType = 'MBL') {
  // Normalize to array
  const files = Array.isArray(filePaths) ? filePaths : [filePaths];
  let allImagePaths = [];
  let allTempImagePaths = [];
  
  try {
    // Process all files (convert PDFs to images, collect image paths)
    for (const filePath of files) {
      if (isPdfFile(filePath)) {
        console.log(`\n📄 Detected PDF file: ${path.basename(filePath)}, converting to images...`);
        const pdfImages = await convertPdfToImages(filePath);
        allImagePaths.push(...pdfImages);
        allTempImagePaths.push(...pdfImages);
      } else {
        console.log(`\n📸 Detected image file: ${path.basename(filePath)}`);
        allImagePaths.push(filePath);
      }
    }

    if (allImagePaths.length === 0) {
      throw new Error('No images to process');
    }

    console.log(`\n🤖 Processing ${allImagePaths.length} image(s) in batches of ${batchSize}...`);
    console.log(`📄 Document type: ${documentType}`);

    // Get the appropriate prompt for the document type
    const extractionPrompt = getPromptForDocumentType(documentType);

    // Process images in batches
    const batches = [];
    for (let i = 0; i < allImagePaths.length; i += batchSize) {
      batches.push(allImagePaths.slice(i, i + batchSize));
    }

    const allExtractedData = [];
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`\n📦 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} image(s))...`);

      // Prepare image content for OpenAI
      const imageContents = batch.map(imagePath => {
        const { base64, mimeType } = imageToBase64(imagePath);
        
        // Ensure MIME type is valid
        const validMimeTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
        if (!validMimeTypes.includes(mimeType)) {
          throw new Error(`Invalid MIME type detected: ${mimeType}`);
        }
        
        console.log(`  📸 ${path.basename(imagePath)} (${mimeType}, ${(base64.length / 1024).toFixed(1)} KB)`);
        
        return {
          type: "image_url",
          image_url: {
            url: `data:${mimeType};base64,${base64}`
          }
        };
      });

      // Send batch to OpenAI with the appropriate prompt
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini", // Using gpt-4o-mini (vision-capable)
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: extractionPrompt },
              ...imageContents
            ]
          }
        ],
        response_format: { type: "json_object" },
        max_tokens: 4000
      });

      const outputText = response.choices[0].message.content;
      const extractedData = JSON.parse(outputText);
      allExtractedData.push(extractedData);
      
      console.log(`✅ Batch ${batchIndex + 1}/${batches.length} completed`);
    }

    // Merge all extracted data (combine line items, etc.)
    const mergedData = mergeExtractedData(allExtractedData);
    
    // Clean up temporary images if they were created from PDF
    if (allTempImagePaths.length > 0) {
      cleanupTempImages(allTempImagePaths);
    }
    
    return mergedData;
  } catch (error) {
    // Clean up temporary images on error
    if (allTempImagePaths.length > 0) {
      cleanupTempImages(allTempImagePaths);
    }
    
    console.error('❌ Error calling OpenAI API:', error);
    
    // Log more details about the error
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    
    throw error;
  }
}

// ============================================================================
// ROUTES
// ============================================================================

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint to upload files (supports multiple files)
app.post('/api/upload', (req, res) => {
  upload.array('files', 50)(req, res, (err) => {
    // Handle multer errors
    if (err) {
      console.error('❌ Multer error:', err);
      
      let errorMessage = 'An error occurred during file upload';
      let statusCode = 500;
      
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          errorMessage = 'File too large. Maximum size is 50MB per file.';
          statusCode = 400;
        } else if (err.code === 'LIMIT_FILE_COUNT') {
          errorMessage = 'Too many files. Maximum 50 files allowed.';
          statusCode = 400;
        } else {
          errorMessage = `Upload error: ${err.message}`;
          statusCode = 400;
        }
      } else if (err.message) {
        errorMessage = err.message;
        statusCode = 400;
      }
      
      return res.status(statusCode).json({
        success: false,
        error: errorMessage
      });
    }
    
    // Handle case where no files were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded'
      });
    }

    try {
      const uploadedFiles = req.files.map(file => ({
        filename: file.filename,
        originalname: file.originalname,
        path: file.path,
        size: file.size
      }));
      
      console.log(`📤 ${uploadedFiles.length} file(s) uploaded:`);
      uploadedFiles.forEach((file, index) => {
        console.log(`   ${index + 1}. ${file.originalname} -> ${file.filename} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
      });

      res.json({
        success: true,
        files: uploadedFiles,
        count: uploadedFiles.length
      });
    } catch (error) {
      console.error('❌ Error processing uploaded files:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'An error occurred while processing the uploaded files'
      });
    }
  });
});

// API endpoint to extract data from uploaded files or default image
app.post('/api/extract', async (req, res) => {
  try {
    let filePaths = [];
    const batchSize = req.body.batchSize || 5; // Default batch size of 5 images
    const documentType = req.body.documentType || 'MBL'; // Document type: COMMERCIAL_INVOICE, HBL, or MBL
    
    // Check if file paths were provided in the request
    if (req.body.filePaths && Array.isArray(req.body.filePaths)) {
      // Multiple files
      filePaths = req.body.filePaths.map(filename => 
        path.resolve(__dirname, UPLOAD_DIR, path.basename(filename))
      );
    } else if (req.body.filePath) {
      // Single file (backward compatibility)
      filePaths = [path.resolve(__dirname, UPLOAD_DIR, path.basename(req.body.filePath))];
    } else {
      // Use default image path
      filePaths = [path.resolve(__dirname, IMAGE_PATH)];
    }
    
    // Check if all files exist
    const missingFiles = filePaths.filter(filePath => !fs.existsSync(filePath));
    if (missingFiles.length > 0) {
      return res.status(404).json({ 
        error: 'File(s) not found',
        message: `File(s) not found: ${missingFiles.map(f => path.basename(f)).join(', ')}` 
      });
    }

    console.log(`📄 Processing ${filePaths.length} file(s): ${filePaths.map(f => path.basename(f)).join(', ')}`);
    console.log(`📋 Document type: ${documentType}`);

    // Extract data from files (handles both PDFs and images, processes in batches)
    const extractedData = await extractDataWithOpenAI(filePaths, batchSize, documentType);

    // Return extracted data
    res.json({
      success: true,
      data: extractedData,
      filesProcessed: filePaths.length,
      documentType: documentType
    });

  } catch (error) {
    console.error('❌ Error during extraction:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'An error occurred during extraction'
    });
  }
});

// Global error handler for unhandled errors
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  
  // If response already sent, delegate to default Express error handler
  if (res.headersSent) {
    return next(err);
  }
  
  // Return JSON error response
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'An unexpected error occurred'
  });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'API endpoint not found'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📄 Make sure your image is at: ${path.resolve(__dirname, IMAGE_PATH)}`);
});
