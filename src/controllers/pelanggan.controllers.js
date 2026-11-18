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

// ─── FIELD MAPPERS (DB UPPER_SNAKE_CASE <-> app camelCase) ───────────────────

const mapPelangganFromDb = (row) => {
	if (!row) return null;
	return {
		idPelanggan: row.ID_PELANGGAN,
		noKontakPdam: row.NO_KONTAK_PDAM,
		namaPelanggan: row.NAMA_PELANGGAN,
		noHp: row.NO_HP,
		alamat: row.ALAMAT,
		createdAt: row.CREATED_AT,
	};
};

const mapUserFromDb = (row) => {
	if (!row) return null;
	return {
		idUser: row.ID_USER,
		namaUser: row.NAMA_USER,
		email: row.EMAIL,
		username: row.USERNAME,
		role: row.ROLE,
		createdAt: row.CREATED_AT,
	};
};

const mapPengaduanFromDb = (row) => {
	if (!row) return null;
	return {
		idPengaduan: row.ID_PENGADUAN,
		idPelanggan: row.ID_PELANGGAN,
		idUserPenerima: row.ID_USER_PENERIMA,
		idUserPenanganan: row.ID_USER_PENANGANAN,
		keluhan: row.KELUHAN,
		status: row.STATUS,
		latitude: row.LATITUDE,
		longitude: row.LONGITUDE,
		dokumenLaporan: row.DOKUMEN_LAPORAN,
		fotoKeluhan: row.FOTO_KELUHAN,
		tanggalDiterima: row.TANGGAL_DITERIMA,
		tanggalDiproses: row.TANGGAL_DIPROSES,
		tanggalSelesai: row.TANGGAL_SELESAI,
		createdAt: row.CREATED_AT,
		updatedAt: row.UPDATED_AT,
		saluranKeluhan: row.SALURAN_KELUHAN,
		sumberAduan: row.SUMBER_ADUAN,
	};
};

// ─── INTERNAL HELPERS ────────────────────────────────────────────────────────

/**
 * Ambil data pelanggan, penerima, dan penanganan secara terpisah
 * dan gabungkan ke dalam objek pengaduan (sudah dimap ke camelCase).
 */
const enrichPengaduan = async (pengaduanDb) => {
	if (!pengaduanDb) return null;

	const pengaduan = mapPengaduanFromDb(pengaduanDb);

	const [pelanggan, penerima, penangani] = await Promise.all([
		pengaduan.idPelanggan
			? prisma.TABEL_PELANGGAN.findUnique({ where: { ID_PELANGGAN: pengaduan.idPelanggan } })
			: null,
		pengaduan.idUserPenerima
			? prisma.TABEL_USER.findUnique({
					where: { ID_USER: pengaduan.idUserPenerima },
					select: { ID_USER: true, NAMA_USER: true, ROLE: true },
			  })
			: null,
		pengaduan.idUserPenanganan
			? prisma.TABEL_USER.findUnique({
					where: { ID_USER: pengaduan.idUserPenanganan },
					select: { ID_USER: true, NAMA_USER: true, ROLE: true },
			  })
			: null,
	]);

	return {
		...pengaduan,
		pelanggan: mapPelangganFromDb(pelanggan),
		penerima: mapUserFromDb(penerima),
		penangani: mapUserFromDb(penangani),
	};
};

/**
 * Enrich banyak pengaduan sekaligus (batch lookup pelanggan & user).
 */
const enrichMany = async (list) => {
	if (!list || list.length === 0) return [];

	const mapped = list.map(mapPengaduanFromDb);

	// Kumpulkan semua id unik
	const pelangganIds = [...new Set(mapped.map((p) => p.idPelanggan).filter(Boolean))];
	const userIds = [
		...new Set([
			...mapped.map((p) => p.idUserPenerima),
			...mapped.map((p) => p.idUserPenanganan),
		].filter(Boolean)),
	];

	const [pelangganList, userList] = await Promise.all([
		pelangganIds.length
			? prisma.TABEL_PELANGGAN.findMany({ where: { ID_PELANGGAN: { in: pelangganIds } } })
			: [],
		userIds.length
			? prisma.TABEL_USER.findMany({
					where: { ID_USER: { in: userIds } },
					select: { ID_USER: true, NAMA_USER: true, ROLE: true },
			  })
			: [],
	]);

	const pelangganMap = Object.fromEntries(pelangganList.map((p) => [p.ID_PELANGGAN, mapPelangganFromDb(p)]));
	const userMap = Object.fromEntries(userList.map((u) => [u.ID_USER, mapUserFromDb(u)]));

	return mapped.map((pengaduan) => ({
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
			const matchedPelanggan = await prisma.TABEL_PELANGGAN.findMany({
				where: { NAMA_PELANGGAN: { contains: search } },
				select: { ID_PELANGGAN: true },
			});
			idPelangganFilter = matchedPelanggan.map((p) => p.ID_PELANGGAN);
			if (idPelangganFilter.length === 0) {
				return res.status(200).json({ success: true, data: [] });
			}
		}

		const whereCondition = {
			...(idPelangganFilter && { ID_PELANGGAN: { in: idPelangganFilter } }),
			...(parsedSumber && { SUMBER_ADUAN: parsedSumber }),
			...(parsedSaluran && { SALURAN_KELUHAN: parsedSaluran }),
		};

		const pengaduanList = await prisma.TABEL_PENGADUAN.findMany({
			where: whereCondition,
			orderBy: { CREATED_AT: "desc" },
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

		const pengaduanList = await prisma.TABEL_PENGADUAN.findMany({
			where: {
				...(status && { STATUS: status.toUpperCase() }),
				...(parsedSumber && { SUMBER_ADUAN: parsedSumber }),
				...(parsedSaluran && { SALURAN_KELUHAN: parsedSaluran }),
			},
			orderBy: { CREATED_AT: "desc" },
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

		const pengaduan = await prisma.TABEL_PENGADUAN.findUnique({
			where: { ID_PENGADUAN: id },
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
			const pelangganBaru = await tx.TABEL_PELANGGAN.create({
				data: {
					NAMA_PELANGGAN: namaPelanggan,
					NO_HP: noHp,
					NO_KONTAK_PDAM: noKontakPdam,
					ALAMAT: alamat,
					CREATED_AT: new Date(),
				},
			});

			const pengaduanBaru = await tx.TABEL_PENGADUAN.create({
				data: {
					ID_PELANGGAN: pelangganBaru.ID_PELANGGAN,
					ID_USER_PENERIMA: idUserCS,
					KELUHAN: keluhan,
					STATUS: "PENDING",
					TANGGAL_DITERIMA: new Date(),
					CREATED_AT: new Date(),
					SUMBER_ADUAN: resolvedSumberAduan,
					SALURAN_KELUHAN: resolvedSaluranKeluhan,
				},
			});

			return {
				pelangganBaru: mapPelangganFromDb(pelangganBaru),
				pengaduanBaru: mapPengaduanFromDb(pengaduanBaru),
			};
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

		const pengaduanExist = await prisma.TABEL_PENGADUAN.findUnique({
			where: { ID_PENGADUAN: id },
		});

		if (!pengaduanExist) {
			return res.status(404).json({ success: false, message: "Data pengaduan tidak ditemukan" });
		}

		// 1. Update Data Pelanggan jika ada
		if (namaPelanggan || noHp || noKontakPdam !== undefined || alamat) {
			await prisma.TABEL_PELANGGAN.update({
				where: { ID_PELANGGAN: pengaduanExist.ID_PELANGGAN },
				data: {
					...(namaPelanggan && { NAMA_PELANGGAN: namaPelanggan }),
					...(noHp && { NO_HP: noHp }),
					...(noKontakPdam !== undefined && { NO_KONTAK_PDAM: noKontakPdam }),
					...(alamat && { ALAMAT: alamat }),
				},
			});
		}

		const extraPengaduanFields = {};
		const parsedSumber = parseSumberAduan(sumberAduan);
		if (parsedSumber) extraPengaduanFields.SUMBER_ADUAN = parsedSumber;
		const parsedSaluran = parseSaluranKeluhan(saluranKeluhan);
		if (parsedSaluran) extraPengaduanFields.SALURAN_KELUHAN = parsedSaluran;

		// 2. Update berdasarkan status
		if (rawStatus === "ON PROGRESS") {
			const updated = await prisma.TABEL_PENGADUAN.update({
				where: { ID_PENGADUAN: id },
				data: {
					STATUS: "ON PROGRESS",
					...(operatorId && { ID_USER_PENANGANAN: operatorId }),
					...(keluhan && { KELUHAN: keluhan }),
					TANGGAL_DIPROSES: new Date(),
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
			const dokumenLaporanPath = req.files?.dokumenLaporan?.[0]?.path || pengaduanExist.DOKUMEN_LAPORAN;
			const fotoKeluhanPath = req.files?.fotoKeluhan?.[0]?.path || pengaduanExist.FOTO_KELUHAN;

			const updated = await prisma.TABEL_PENGADUAN.update({
				where: { ID_PENGADUAN: id },
				data: {
					STATUS: "SELESAI",
					...(latitude && { LATITUDE: latitude }),
					...(longitude && { LONGITUDE: longitude }),
					...(dokumenLaporanPath && { DOKUMEN_LAPORAN: dokumenLaporanPath }),
					...(fotoKeluhanPath && { FOTO_KELUHAN: fotoKeluhanPath }),
					...(keluhan && { KELUHAN: keluhan }),
					...(operatorId && { ID_USER_PENANGANAN: operatorId }),
					TANGGAL_SELESAI: new Date(),
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
		if (keluhan) updateDataPayload.KELUHAN = keluhan;
		if (operatorId) updateDataPayload.ID_USER_PENANGANAN = operatorId;

		const updated = await prisma.TABEL_PENGADUAN.update({
			where: { ID_PENGADUAN: id },
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
			const matchedPelanggan = await prisma.TABEL_PELANGGAN.findMany({
				where: { NAMA_PELANGGAN: { contains: search } },
				select: { ID_PELANGGAN: true },
			});
			idPelangganFilter = matchedPelanggan.map((p) => p.ID_PELANGGAN);
			if (idPelangganFilter.length === 0) {
				return res.status(200).json({ success: true, data: [] });
			}
		}

		const history = await prisma.TABEL_PENGADUAN.findMany({
			where: {
				STATUS: "SELESAI",
				...(idPelangganFilter && { ID_PELANGGAN: { in: idPelangganFilter } }),
				...(parsedSumber && { SUMBER_ADUAN: parsedSumber }),
				...(parsedSaluran && { SALURAN_KELUHAN: parsedSaluran }),
			},
			orderBy: { TANGGAL_SELESAI: "desc" },
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

		const pengaduan = await prisma.TABEL_PENGADUAN.findUnique({
			where: { ID_PENGADUAN: id },
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

		const pengaduan = await prisma.TABEL_PENGADUAN.findUnique({
			where: { ID_PENGADUAN: id },
			select: { DOKUMEN_LAPORAN: true },
		});

		if (!pengaduan) {
			return res.status(404).json({ success: false, message: "Data pengaduan tidak ditemukan" });
		}

		return serveUploadedFile(res, pengaduan.DOKUMEN_LAPORAN, "dokumen-laporan");
	} catch (error) {
		next(error);
	}
};

export const viewFotoKeluhan = async (req, res, next) => {
	try {
		const { id } = req.params;

		const pengaduan = await prisma.TABEL_PENGADUAN.findUnique({
			where: { ID_PENGADUAN: id },
			select: { FOTO_KELUHAN: true },
		});

		if (!pengaduan) {
			return res.status(404).json({ success: false, message: "Data pengaduan tidak ditemukan" });
		}

		return serveUploadedFile(res, pengaduan.FOTO_KELUHAN, "foto-keluhan");
	} catch (error) {
		next(error);
	}
};
