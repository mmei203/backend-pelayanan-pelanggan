import multer from "multer";
import path from "path";
import fs from "fs";
import { put } from "@vercel/blob";
import { uploadsDir } from "../config/uploads.js";

if (!process.env.VERCEL && !fs.existsSync(uploadsDir)) {
	fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
	destination: (req, file, cb) => {
		if (!fs.existsSync(uploadsDir)) {
			fs.mkdirSync(uploadsDir, { recursive: true });
		}
		cb(null, uploadsDir);
	},
	filename: (req, file, cb) => {
		const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
		const ext = path.extname(file.originalname);
		cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
	},
});

export const uploadMiddleware = multer({
	storage: process.env.VERCEL ? multer.memoryStorage() : storage,
	limits: { fileSize: 10 * 1024 * 1024 }, // Batas maksimal file 10MB
});

export const persistUploadedFiles = async (req, res, next) => {
	if (!process.env.VERCEL) return next();

	const files = Object.values(req.files ?? {}).flat();
	await Promise.all(
		files.map(async (file) => {
			const blob = await put(file.filename, file.buffer, {
				access: "public",
				contentType: file.mimetype,
			});
			file.path = blob.url;
			delete file.buffer;
		}),
	);

	next();
};
