import multer from "multer";
import path from "path";
import fs from "fs";
import os from "os";

// Di Vercel serverless gunakan folder tmp, di lokal gunakan uploads/
const uploadDir = process.env.VERCEL ? path.join(os.tmpdir(), "uploads") : "uploads/";
if (!fs.existsSync(uploadDir)) {
	fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
	destination: (req, file, cb) => {
		if (!fs.existsSync(uploadDir)) {
			fs.mkdirSync(uploadDir, { recursive: true });
		}
		cb(null, uploadDir);
	},
	filename: (req, file, cb) => {
		const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
		const ext = path.extname(file.originalname);
		cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
	},
});

export const uploadMiddleware = multer({
	storage,
	limits: { fileSize: 10 * 1024 * 1024 }, // Batas maksimal file 10MB
});
