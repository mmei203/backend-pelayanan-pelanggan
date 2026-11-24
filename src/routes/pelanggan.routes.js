import { Router } from "express";
import {
	getAllPelanggan,
	getPelangganByStatus,
	getPelangganById,
	createPelanggan,
	updatePelanggan,
	getHistory,
	printPengaduan,
	viewPengaduanFile,
	deletePengaduanFile,
	viewDokumenLaporan,
	viewFotoKeluhan,
} from "../controllers/pelanggan.controllers.js";
import { uploadMiddleware } from "../middlewares/upload.middleware.js";

const router = Router();

router.get("/pelanggan", getAllPelanggan);
router.get("/pelanggan/filter", getPelangganByStatus);
router.get("/pelanggan/history", getHistory);
router.get("/pelanggan/:id/print", printPengaduan);
router.get("/pelanggan/:id/files/:fileId", viewPengaduanFile);
router.delete("/pelanggan/:id/files/:fileId", deletePengaduanFile);
router.get("/pelanggan/:id/dokumen", viewDokumenLaporan);
router.get("/pelanggan/:id/foto", viewFotoKeluhan);
router.get("/pelanggan/:id", getPelangganById);
router.post(
	"/pelanggan",
	uploadMiddleware.fields([
		{ name: "dokumenLaporan", maxCount: 5 },
		{ name: "fotoKeluhan", maxCount: 5 },
	]),
	createPelanggan,
);

router.put(
	"/pelanggan/:id",
	uploadMiddleware.fields([
		{ name: "dokumenLaporan", maxCount: 5 },
		{ name: "fotoKeluhan", maxCount: 5 },
	]),
	updatePelanggan,
);

export default router;
