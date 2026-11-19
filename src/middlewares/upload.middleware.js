import multer from "multer";

export const uploadMiddleware = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 10 * 1024 * 1024 }, // Batas maksimal file 10MB
});
