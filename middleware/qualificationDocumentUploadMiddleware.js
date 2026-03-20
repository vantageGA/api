import multer from 'multer';
import os from 'os';
import path from 'path';

export const QUALIFICATION_DOCUMENT_UPLOAD_FIELD = 'qualificationDocument';
export const MAX_QUALIFICATION_DOCUMENT_SIZE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_QUALIFICATION_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, os.tmpdir());
  },
  filename: (req, file, cb) => {
    const safeBaseName = path
      .basename(file.originalname, path.extname(file.originalname))
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .slice(0, 80);
    const extension = path.extname(file.originalname) || '';
    cb(
      null,
      `qualification-document-${Date.now()}-${safeBaseName}${extension}`,
    );
  },
});

const qualificationDocumentUpload = multer({
  storage,
  limits: {
    fileSize: MAX_QUALIFICATION_DOCUMENT_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_QUALIFICATION_DOCUMENT_MIME_TYPES.has(file.mimetype)) {
      return cb(
        new Error('Only PDF, JPG, and PNG qualification documents are allowed'),
      );
    }

    cb(null, true);
  },
}).single(QUALIFICATION_DOCUMENT_UPLOAD_FIELD);

export const handleQualificationDocumentUpload = (req, res, next) => {
  qualificationDocumentUpload(req, res, (error) => {
    if (!error) {
      return next();
    }

    res.status(400);

    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return next(new Error('Qualification document must be 5MB or less'));
      }

      if (error.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(
          new Error(
            `Qualification document upload field must be '${QUALIFICATION_DOCUMENT_UPLOAD_FIELD}'`,
          ),
        );
      }

      return next(new Error(`Qualification document upload failed: ${error.message}`));
    }

    return next(error instanceof Error ? error : new Error('Qualification document upload failed'));
  });
};
