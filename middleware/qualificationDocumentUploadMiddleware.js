import multer from 'multer';

export const QUALIFICATION_DOCUMENT_UPLOAD_FIELD = 'qualificationDocument';
export const MAX_QUALIFICATION_DOCUMENT_SIZE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_QUALIFICATION_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);

const qualificationDocumentUpload = multer({
  storage: multer.memoryStorage(),
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
