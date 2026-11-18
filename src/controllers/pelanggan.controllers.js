import fs from "fs";
import path from "path";
import { prisma } from "../config/db.js";
import { formatFileUrl } from "../utils/url.helper.js";
import { generateFormulirAduanPelangganPDF } from "../utils/pdf.helper.js";

// ─── ENUM HELPERS ────────────────────────────────────────────────────────────

// Normalisasi input → enum TABEL_PENGADUAN_SUMBER_ADUAN
const parseSumberAduan = (value) => {
	if (!value) return undefined;
	const val = String(value).trim().toLowerCase();
	if (
		val === "non_pelangan" ||
		val === "non pelangan" ||
		val === "non_pelanggan" ||
		val === "non pelanggan" ||
		val === "non"
	) {
		return "Non_Pelangan"; // sesuai enum schema
	}
	if (val === "pelanggan") return "Pelanggan";
	return undefined;
};

// Normalisasi input → enum TABEL_PENGADUAN_SALURAN_KELUHAN
const parseSaluranKeluhan = (value) => {
	if (!value) return undefined;
	const val = String(value).trim().toLowerCase();
	if (val === "datang langsung" || val === "datang_langsung") return "Datang_Langsung";
	if (val === "via telepon" || val === "via_telepon" || val === "telepon" || val === "telp") return "Via_Telepon";
	if (val === "temuan lapangan" || val === "temuan_lapangan" || val === "temuan") return "Temuan_Lapangan";
	return undefined;
};

// ─── INTERNAL HELPERS ────────────────────────────────────────────────────────

/**
 * Ambil data pelanggan, penerima, dan penanganan secara terpisah
 * dan gabungkan ke dalam objek pengaduan.
 */
const enrichPengaduan = async (pengaduan) => {
	if (!pengaduan) return null;

	const [pelanggan, penerima, penangani] = await Promise.all([
		pengaduan.idPelanggan
			? prisma.tabelPelanggan.findUnique({ where: { idPelanggan: pengaduan.idPelanggan } })
			: null,
		pengaduan.idUserPenerima
			? prisma.tabelUser.findUnique({
					where: { idUser: pengaduan.idUserPenerima },
					select: { namaUser: true, role: true },
			  })
			: null,
		pengaduan.idUserPenanganan
			? prisma.tabelUser.findUnique({
					where: { idUser: pengaduan.idUserPenanganan },
					select: { namaUser: true, role: true },
			  })
			: null,
	]);

	return { ...pengaduan, pelanggan, penerima, penangani };
};

/**
 * Enrich banyak pengaduan sekaligus (batch lookup pelanggan & user).
 */
const enrichMany = async (list) => {
	if (!list || list.length === 0) return [];

	// Kumpulkan semua id unik
	const pelangganIds = [...new Set(list.map((p) => p.idPelanggan).filter(Boolean))];
	const userIds = [
		...new Set([
			...list.map((p) => p.idUserPenerima),
			...list.map((p) => p.idUserPenanganan),
		].filter(Boolean)),
	];

	const [pelangganList, userList] = await Promise.all([
		prisma.tabelPelanggan.findMany({ where: { idPelanggan: { in: pelangganIds } } }),
		prisma.tabelUser.findMany({
			where: { idUser: { in: userIds } },
			select: { idUser: true, namaUser: true, role: true },
		}),
	]);

	const pelangganMap = Object.fromEntries(pelangganList.map((p) => [p.idPelanggan, p]));
	const userMap = Object.fromEntries(userList.map((u) => [u.idUser, u]));

	return list.map((pengaduan) => ({
		...pengaduan,
		pelanggan: pelangganMap[pengaduan.idPelanggan] || null,
		penerima: userMap[pengaduan.idUserPenerima] || null,
		penangani: userMap[pengaduan.idUserPenanganan] || null,
	}));
};

// ─── CONTROLLERS ─────────────────────────────────────────────────────────────

export const getAllPelanggan = async (req, res, next) => {
	try {
		const { search, sumberAduan, saluranKeluhan } = req.query;

		const parsedSumber = parseSumberAduan(sumberAduan);
		const parsedSaluran = parseSaluranKeluhan(saluranKeluhan);

		// Jika search by namaPelanggan: ambil id pelanggan dulu lalu filter pengaduan
		let idPelangganFilter;
		if (search) {
			const matchedPelanggan = await prisma.tabelPelanggan.findMany({
				where: { namaPelanggan: { contains: search } },
				select: { idPelanggan: true },
			});
			idPelangganFilter = matchedPelanggan.map((p) => p.idPelanggan);
			if (idPelangganFilter.length === 0) {
				return res.status(200).json({ success: true, data: [] });
			}
		}

		const whereCondition = {
			...(idPelangganFilter && { idPelanggan: { in: idPelangganFilter } }),
			...(parsedSumber && { sumberAduan: parsedSumber }),
			...(parsedSaluran && { saluranKeluhan: parsedSaluran }),
		};

		const pengaduanList = await prisma.tabelPengaduan.findMany({
			where: whereCondition,
			orderBy: { createdAt: "desc" },
		});

		const enriched = await enrichMany(pengaduanList);

		const formattedData = enriched.map((item) => ({
			...item,
			dokumenLaporan: formatFileUrl(req, item.dokumenLaporan),
			fotoKeluhan: formatFileUrl(req, item.fotoKeluhan),
		}));

		res.status(200).json({ success: true, data: formattedData });
	} catch (error) {
		next(error);
	}
};

export const getPelangganByStatus = async (req, res, next) => {
	try {
		const { status, sumberAduan, saluranKeluhan } = req.query;

		const parsedSumber = parseSumberAduan(sumberAduan);
		const parsedSaluran = parseSaluranKeluhan(saluranKeluhan);

		const pengaduanList = await prisma.tabelPengaduan.findMany({
			where: {
				...(status && { status: status.toUpperCase() }),
				...(parsedSumber && { sumberAduan: parsedSumber }),
				...(parsedSaluran && { saluranKeluhan: parsedSaluran }),
			},
			orderBy: { createdAt: "desc" },
		});

		const enriched = await enrichMany(pengaduanList);

		const formattedData = enriched.map((item) => ({
			...item,
			dokumenLaporan: formatFileUrl(req, item.dokumenLaporan),
			fotoKeluhan: formatFileUrl(req, item.fotoKeluhan),
		}));

		res.status(200).json({ success: true, data: formattedData });
	} catch (error) {
		next(error);
	}
};

export const getPelangganById = async (req, res, next) => {
	try {
		const { id } = req.params;

		const pengaduan = await prisma.tabelPengaduan.findUnique({
			where: { idPengaduan: id },
		});

		if (!pengaduan) {
			return res.status(404).json({ success: false, message: "Data pengaduan tidak ditemukan" });
		}

		const enriched = await enrichPengaduan(pengaduan);

		const formattedData = {
			...enriched,
			dokumenLaporan: formatFileUrl(req, enriched.dokumenLaporan),
			fotoKeluhan: formatFileUrl(req, enriched.fotoKeluhan),
		};

		res.status(200).json({ success: true, data: formattedData });
	} catch (error) {
		next(error);
	}
};

export const createPelanggan = async (req, res, next) => {
	try {
		const {
			namaPelanggan,
			noHp,
			noKontakPdam,
			alamat,
			keluhan,
			idUserCS,
			sumberAduan,
			saluranKeluhan,
		} = req.body;

		if (!idUserCS) {
			return res.status(400).json({ success: false, message: "idUserCS wajib diisi" });
		}

		// Validasi / penentuan sumberAduan
		let resolvedSumberAduan = parseSumberAduan(sumberAduan);
		if (!resolvedSumberAduan) {
			resolvedSumberAduan =
				noKontakPdam && noKontakPdam.trim() !== "" ? "Pelanggan" : "Non_Pelangan";
		}

		// Validasi / penentuan saluranKeluhan — default: Datang_Langsung
		const resolvedSaluranKeluhan = parseSaluranKeluhan(saluranKeluhan) || "Datang_Langsung";

		const result = await prisma.$transaction(async (tx) => {
			const pelangganBaru = await tx.tabelPelanggan.create({
				data: { namaPelanggan, noHp, noKontakPdam, alamat },
			});

			const pengaduanBaru = await tx.tabelPengaduan.create({
				data: {
					idPelanggan: pelangganBaru.idPelanggan,
					idUserPenerima: idUserCS,
					keluhan,
					status: "PENDING",
					tanggalDiterima: new Date(),
					createdAt: new Date(),
					sumberAduan: resolvedSumberAduan,
					saluranKeluhan: resolvedSaluranKeluhan,
				},
			});

			return { pelangganBaru, pengaduanBaru };
		});

		res.status(201).json({
			success: true,
			message: "Pengaduan berhasil ditambahkan",
			data: result,
		});
	} catch (error) {
		next(error);
	}
};

export const updatePelanggan = async (req, res, next) => {
	try {
		const { id } = req.params;
		const rawStatus = req.body.status ? req.body.status.replace(/"/g, "").trim() : "";
		const {
			operatorId,
			latitude,
			longitude,
			namaPelanggan,
			noHp,
			noKontakPdam,
			alamat,
			keluhan,
			sumberAduan,
			saluranKeluhan,
		} = req.body;

		const pengaduanExist = await prisma.tabelPengaduan.findUnique({
			where: { idPengaduan: id },
		});

		if (!pengaduanExist) {
			return res.status(404).json({ success: false, message: "Data pengaduan tidak ditemukan" });
		}

		// 1. Update Data Pelanggan jika ada
		if (namaPelanggan || noHp || noKontakPdam !== undefined || alamat) {
			await prisma.tabelPelanggan.update({
				where: { idPelanggan: pengaduanExist.idPelanggan },
				data: {
					...(namaPelanggan && { namaPelanggan }),
					...(noHp && { noHp }),
					...(noKontakPdam !== undefined && { noKontakPdam }),
					...(alamat && { alamat }),
				},
			});
		}

		const extraPengaduanFields = {};
		const parsedSumber = parseSumberAduan(sumberAduan);
		if (parsedSumber) extraPengaduanFields.sumberAduan = parsedSumber;
		const parsedSaluran = parseSaluranKeluhan(saluranKeluhan);
		if (parsedSaluran) extraPengaduanFields.saluranKeluhan = parsedSaluran;

		// 2. Update berdasarkan status
		if (rawStatus === "ON PROGRESS") {
			const updated = await prisma.tabelPengaduan.update({
				where: { idPengaduan: id },
				data: {
					status: "ON PROGRESS",
					...(operatorId && { idUserPenanganan: operatorId }),
					...(keluhan && { keluhan }),
					tanggalDiproses: new Date(),
					...extraPengaduanFields,
				},
			});

			const enriched = await enrichPengaduan(updated);
			return res.status(200).json({
				success: true,
				message: "Data berhasil diperbarui menjadi ON PROGRESS",
				data: {
					...enriched,
					dokumenLaporan: formatFileUrl(req, enriched.dokumenLaporan),
					fotoKeluhan: formatFileUrl(req, enriched.fotoKeluhan),
				},
			});
		}

		if (rawStatus === "SELESAI") {
			const dokumenLaporanPath = req.files?.dokumenLaporan?.[0]?.path || pengaduanExist.dokumenLaporan;
			const fotoKeluhanPath = req.files?.fotoKeluhan?.[0]?.path || pengaduanExist.fotoKeluhan;

			const updated = await prisma.tabelPengaduan.update({
				where: { idPengaduan: id },
				data: {
					status: "SELESAI",
					...(latitude && { latitude }),
					...(longitude && { longitude }),
					...(dokumenLaporanPath && { dokumenLaporan: dokumenLaporanPath }),
					...(fotoKeluhanPath && { fotoKeluhan: fotoKeluhanPath }),
					...(keluhan && { keluhan }),
					...(operatorId && { idUserPenanganan: operatorId }),
					tanggalSelesai: new Date(),
					...extraPengaduanFields,
				},
			});

			const enriched = await enrichPengaduan(updated);
			return res.status(200).json({
				success: true,
				message: "Data pengaduan berhasil diselesaikan dan diperbarui",
				data: {
					...enriched,
					dokumenLaporan: formatFileUrl(req, enriched.dokumenLaporan),
					fotoKeluhan: formatFileUrl(req, enriched.fotoKeluhan),
				},
			});
		}

		// 3. Update teks saja tanpa ubah status
		const updateDataPayload = { ...extraPengaduanFields };
		if (keluhan) updateDataPayload.keluhan = keluhan;
		if (operatorId) updateDataPayload.idUserPenanganan = operatorId;

		const updated = await prisma.tabelPengaduan.update({
			where: { idPengaduan: id },
			data: updateDataPayload,
		});

		const enriched = await enrichPengaduan(updated);
		return res.status(200).json({
			success: true,
			message: "Data pelanggan dan pengaduan berhasil diperbarui",
			data: {
				...enriched,
				dokumenLaporan: formatFileUrl(req, enriched.dokumenLaporan),
				fotoKeluhan: formatFileUrl(req, enriched.fotoKeluhan),
			},
		});
	} catch (error) {
		next(error);
	}
};

export const getHistory = async (req, res, next) => {
	try {
		const { search, sumberAduan, saluranKeluhan } = req.query;

		const parsedSumber = parseSumberAduan(sumberAduan);
		const parsedSaluran = parseSaluranKeluhan(saluranKeluhan);

		let idPelangganFilter;
		if (search) {
			const matchedPelanggan = await prisma.tabelPelanggan.findMany({
				where: { namaPelanggan: { contains: search } },
				select: { idPelanggan: true },
			});
			idPelangganFilter = matchedPelanggan.map((p) => p.idPelanggan);
			if (idPelangganFilter.length === 0) {
				return res.status(200).json({ success: true, data: [] });
			}
		}

		const history = await prisma.tabelPengaduan.findMany({
			where: {
				status: "SELESAI",
				...(idPelangganFilter && { idPelanggan: { in: idPelangganFilter } }),
				...(parsedSumber && { sumberAduan: parsedSumber }),
				...(parsedSaluran && { saluranKeluhan: parsedSaluran }),
			},
			orderBy: { tanggalSelesai: "desc" },
		});

		const enriched = await enrichMany(history);

		const formattedData = enriched.map((item) => ({
			...item,
			dokumenLaporan: formatFileUrl(req, item.dokumenLaporan),
			fotoKeluhan: formatFileUrl(req, item.fotoKeluhan),
		}));

		res.status(200).json({ success: true, data: formattedData });
	} catch (error) {
		next(error);
	}
};

export const printPengaduan = async (req, res, next) => {
	try {
		const { id } = req.params;

		const pengaduan = await prisma.tabelPengaduan.findUnique({
			where: { idPengaduan: id },
		});

		if (!pengaduan) {
			return res.status(404).json({ success: false, message: "Data pengaduan tidak ditemukan" });
		}

		const enriched = await enrichPengaduan(pengaduan);

		res.setHeader("Content-Type", "application/pdf");
		res.setHeader("Content-Disposition", `inline; filename="formulir-aduan-${id}.pdf"`);

		generateFormulirAduanPelangganPDF(enriched, res);
	} catch (error) {
		next(error);
	}
};

// ─── FILE SERVING ─────────────────────────────────────────────────────────────

const serveUploadedFile = (res, filePath, fallbackName = "file") => {
	if (!filePath) {
		return res.status(404).json({ success: false, message: "File dokumentasi tidak tersedia" });
	}

	if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
		return res.redirect(filePath);
	}

	const resolvedPath = path.isAbsolute(filePath)
		? filePath
		: path.resolve(process.cwd(), filePath);

	if (!fs.existsSync(resolvedPath)) {
		return res
			.status(404)
			.json({ success: false, message: "File fisik tidak ditemukan di server" });
	}

	return res.sendFile(resolvedPath);
};

export const viewDokumenLaporan = async (req, res, next) => {
	try {
		const { id } = req.params;

		const pengaduan = await prisma.tabelPengaduan.findUnique({
			where: { idPengaduan: id },
			select: { dokumenLaporan: true },
		});

		if (!pengaduan) {
			return res.status(404).json({ success: false, message: "Data pengaduan tidak ditemukan" });
		}

		return serveUploadedFile(res, pengaduan.dokumenLaporan, "dokumen-laporan");
	} catch (error) {
		next(error);
	}
};

export const viewFotoKeluhan = async (req, res, next) => {
	try {
		const { id } = req.params;

		const pengaduan = await prisma.tabelPengaduan.findUnique({
			where: { idPengaduan: id },
			select: { fotoKeluhan: true },
		});

		if (!pengaduan) {
			return res.status(404).json({ success: false, message: "Data pengaduan tidak ditemukan" });
		}

		return serveUploadedFile(res, pengaduan.fotoKeluhan, "foto-keluhan");
	} catch (error) {
		next(error);
	}
};
