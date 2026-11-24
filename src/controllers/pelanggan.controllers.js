import fs from "fs";
import { randomUUID } from "crypto";
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

const getFileMetadata = async (pengaduanIds) => {
	if (!pengaduanIds.length) return new Map();

	const [files, legacyFiles] = await Promise.all([
		prisma.TABEL_PENGADUAN_FILE_ITEM.findMany({
			where: { ID_PENGADUAN: { in: pengaduanIds } },
			select: {
				ID_FILE: true,
				ID_PENGADUAN: true,
				JENIS_FILE: true,
				NAMA_FILE: true,
				MIME_TYPE: true,
				CREATED_AT: true,
			},
			orderBy: [{ CREATED_AT: "asc" }, { ID_FILE: "asc" }],
		}),
		prisma.TABEL_PENGADUAN_FILE.findMany({
			where: { ID_PENGADUAN: { in: pengaduanIds } },
			select: {
				ID_PENGADUAN: true,
				DOKUMEN_LAPORAN_MIME: true,
				DOKUMEN_LAPORAN_NAMA: true,
				FOTO_KELUHAN_MIME: true,
				FOTO_KELUHAN_NAMA: true,
			},
		}),
	]);

	const filesByPengaduan = new Map(pengaduanIds.map((id) => [id, []]));
	for (const file of files) {
		filesByPengaduan.get(file.ID_PENGADUAN)?.push({
			id: file.ID_FILE,
			type: file.JENIS_FILE,
			name: file.NAMA_FILE,
			mimeType: file.MIME_TYPE,
			createdAt: file.CREATED_AT,
		});
	}

	for (const file of legacyFiles) {
		const items = filesByPengaduan.get(file.ID_PENGADUAN);
		if (file.DOKUMEN_LAPORAN_MIME || file.DOKUMEN_LAPORAN_NAMA) {
			items?.push({
				id: "legacy-dokumen",
				type: "dokumenLaporan",
				name: file.DOKUMEN_LAPORAN_NAMA,
				mimeType: file.DOKUMEN_LAPORAN_MIME,
				legacy: true,
			});
		}
		if (file.FOTO_KELUHAN_MIME || file.FOTO_KELUHAN_NAMA) {
			items?.push({
				id: "legacy-foto",
				type: "fotoKeluhan",
				name: file.FOTO_KELUHAN_NAMA,
				mimeType: file.FOTO_KELUHAN_MIME,
				legacy: true,
			});
		}
	}

	return filesByPengaduan;
};

const formatPengaduanFiles = (req, pengaduan) => {
	const fileUrl = (file) =>
		file.legacy
			? `${req.protocol}://${req.get("host")}/api/pelanggan/${pengaduan.idPengaduan}/${file.type === "dokumenLaporan" ? "dokumen" : "foto"}`
			: `${req.protocol}://${req.get("host")}/api/pelanggan/${pengaduan.idPengaduan}/files/${file.id}`;
	const formatList = (type, legacyPath) => {
		const files = pengaduan.files
			.filter((file) => file.type === type)
			.map((file) => ({ ...file, url: fileUrl(file) }));
		const legacyUrl = formatFileUrl(req, legacyPath);
		if (
			legacyUrl &&
			!files.some((file) => file.url === legacyUrl) &&
			!legacyUrl.endsWith(type === "dokumenLaporan" ? "/dokumen" : "/foto")
		) {
			files.push({
				id: null,
				type,
				name: path.basename(legacyPath),
				mimeType: null,
				url: legacyUrl,
			});
		}
		return files;
	};

	const dokumenLaporanFiles = formatList("dokumenLaporan", pengaduan.dokumenLaporan);
	const fotoKeluhanFiles = formatList("fotoKeluhan", pengaduan.fotoKeluhan);
	const publicPengaduan = { ...pengaduan };
	delete publicPengaduan.files;

	return {
		...publicPengaduan,
		dokumenLaporan: dokumenLaporanFiles[0]?.url || null,
		fotoKeluhan: fotoKeluhanFiles[0]?.url || null,
		dokumenLaporanFiles,
		fotoKeluhanFiles,
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

	const [pelanggan, penerima, penangani, filesByPengaduan] = await Promise.all([
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
		getFileMetadata([pengaduan.idPengaduan]),
	]);

	return {
		...pengaduan,
		files: filesByPengaduan.get(pengaduan.idPengaduan) || [],
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
	const pengaduanIds = mapped.map((p) => p.idPengaduan);

	const [pelangganList, userList, filesByPengaduan] = await Promise.all([
		pelangganIds.length
			? prisma.TABEL_PELANGGAN.findMany({ where: { ID_PELANGGAN: { in: pelangganIds } } })
			: [],
		userIds.length
			? prisma.TABEL_USER.findMany({
					where: { ID_USER: { in: userIds } },
					select: { ID_USER: true, NAMA_USER: true, ROLE: true },
			  })
			: [],
		getFileMetadata(pengaduanIds),
	]);

	const pelangganMap = Object.fromEntries(pelangganList.map((p) => [p.ID_PELANGGAN, mapPelangganFromDb(p)]));
	const userMap = Object.fromEntries(userList.map((u) => [u.ID_USER, mapUserFromDb(u)]));

	return mapped.map((pengaduan) => ({
		...pengaduan,
		files: filesByPengaduan.get(pengaduan.idPengaduan) || [],
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

		const formattedData = enriched.map((item) => formatPengaduanFiles(req, item));

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

		const formattedData = enriched.map((item) => formatPengaduanFiles(req, item));

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

		const formattedData = formatPengaduanFiles(req, enriched);

		res.status(200).json({ success: true, data: formattedData });
	} catch (error) {
		next(error);
	}
};

const buildFileRecords = (pengaduanId, files = {}) =>
	[
		...(files.dokumenLaporan || []).map((file) => ["dokumenLaporan", file]),
		...(files.fotoKeluhan || []).map((file) => ["fotoKeluhan", file]),
	].map(([type, file]) => ({
		ID_FILE: randomUUID(),
		ID_PENGADUAN: pengaduanId,
		JENIS_FILE: type,
		NAMA_FILE: path.basename(file.originalname.replace(/\\/g, "/")).slice(0, 255),
		MIME_TYPE: file.mimetype.slice(0, 100),
		FILE_DATA: file.buffer,
	}));

const fileEndpoint = (pengaduanId, fileId) =>
	`/api/pelanggan/${pengaduanId}/files/${fileId}`;

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
		const pengaduanId = randomUUID();
		const uploadedFiles = buildFileRecords(pengaduanId, req.files);
		const firstDocument = uploadedFiles.find((file) => file.JENIS_FILE === "dokumenLaporan");
		const firstPhoto = uploadedFiles.find((file) => file.JENIS_FILE === "fotoKeluhan");
		const dokumenLaporanPath = firstDocument
			? fileEndpoint(pengaduanId, firstDocument.ID_FILE)
			: undefined;
		const fotoKeluhanPath = firstPhoto
			? fileEndpoint(pengaduanId, firstPhoto.ID_FILE)
			: undefined;

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
					ID_PELANGGAN: randomUUID(),
					NAMA_PELANGGAN: namaPelanggan,
					NO_HP: noHp,
					NO_KONTAK_PDAM: noKontakPdam,
					ALAMAT: alamat,
					CREATED_AT: new Date(),
				},
			});
			const pengaduanBaru = await tx.TABEL_PENGADUAN.create({
				data: {
					ID_PENGADUAN: pengaduanId,
					ID_PELANGGAN: pelangganBaru.ID_PELANGGAN,
					ID_USER_PENERIMA: idUserCS,
					KELUHAN: keluhan,
					STATUS: "PENDING",
					...(dokumenLaporanPath && { DOKUMEN_LAPORAN: dokumenLaporanPath }),
					...(fotoKeluhanPath && { FOTO_KELUHAN: fotoKeluhanPath }),
					TANGGAL_DITERIMA: new Date(),
					CREATED_AT: new Date(),
					SUMBER_ADUAN: resolvedSumberAduan,
					SALURAN_KELUHAN: resolvedSaluranKeluhan,
				},
			});

			if (uploadedFiles.length) {
				await tx.TABEL_PENGADUAN_FILE_ITEM.createMany({ data: uploadedFiles });
			}

			return {
				pelangganBaru: mapPelangganFromDb(pelangganBaru),
				pengaduanBaru,
			};
		});

		const enriched = await enrichPengaduan(result.pengaduanBaru);
		const formattedPengaduan = formatPengaduanFiles(req, enriched);
		res.status(201).json({
			success: true,
			message: "Pengaduan berhasil ditambahkan",
			data: {
				pelangganBaru: result.pelangganBaru,
				pengaduanBaru: formattedPengaduan,
				dokumenLaporan: formattedPengaduan.dokumenLaporan,
				dokumenLaporanFiles: formattedPengaduan.dokumenLaporanFiles,
				fotoKeluhan: formattedPengaduan.fotoKeluhan,
				fotoKeluhanFiles: formattedPengaduan.fotoKeluhanFiles,
			},
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

		const uploadedFiles = buildFileRecords(id, req.files);
		const firstDocument = uploadedFiles.find((file) => file.JENIS_FILE === "dokumenLaporan");
		const firstPhoto = uploadedFiles.find((file) => file.JENIS_FILE === "fotoKeluhan");
		const dokumenLaporanPath = firstDocument
			? fileEndpoint(id, firstDocument.ID_FILE)
			: pengaduanExist.DOKUMEN_LAPORAN;
		const fotoKeluhanPath = firstPhoto
			? fileEndpoint(id, firstPhoto.ID_FILE)
			: pengaduanExist.FOTO_KELUHAN;
		const updatePengaduan = async (data) =>
			prisma.$transaction(async (tx) => {
				const updated = await tx.TABEL_PENGADUAN.update({
					where: { ID_PENGADUAN: id },
					data,
				});

				if (uploadedFiles.length) {
					await tx.TABEL_PENGADUAN_FILE_ITEM.createMany({ data: uploadedFiles });
				}

				return updated;
			});

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
			const updated = await updatePengaduan({
				STATUS: "ON PROGRESS",
				...(operatorId && { ID_USER_PENANGANAN: operatorId }),
				...(keluhan && { KELUHAN: keluhan }),
				...(dokumenLaporanPath && { DOKUMEN_LAPORAN: dokumenLaporanPath }),
				...(fotoKeluhanPath && { FOTO_KELUHAN: fotoKeluhanPath }),
				TANGGAL_DIPROSES: new Date(),
				...extraPengaduanFields,
			});

			const enriched = await enrichPengaduan(updated);
			return res.status(200).json({
				success: true,
				message: "Data berhasil diperbarui menjadi ON PROGRESS",
				data: formatPengaduanFiles(req, enriched),
			});
		}

		if (rawStatus === "SELESAI") {
			const updated = await updatePengaduan({
				STATUS: "SELESAI",
				...(latitude && { LATITUDE: latitude }),
				...(longitude && { LONGITUDE: longitude }),
				...(dokumenLaporanPath && { DOKUMEN_LAPORAN: dokumenLaporanPath }),
				...(fotoKeluhanPath && { FOTO_KELUHAN: fotoKeluhanPath }),
				...(keluhan && { KELUHAN: keluhan }),
				...(operatorId && { ID_USER_PENANGANAN: operatorId }),
				TANGGAL_SELESAI: new Date(),
				...extraPengaduanFields,
			});

			const enriched = await enrichPengaduan(updated);
			return res.status(200).json({
				success: true,
				message: "Data pengaduan berhasil diselesaikan dan diperbarui",
				data: formatPengaduanFiles(req, enriched),
			});
		}

		// 3. Update teks saja tanpa ubah status
		const updateDataPayload = { ...extraPengaduanFields };
		if (keluhan) updateDataPayload.KELUHAN = keluhan;
		if (operatorId) updateDataPayload.ID_USER_PENANGANAN = operatorId;
		if (dokumenLaporanPath) updateDataPayload.DOKUMEN_LAPORAN = dokumenLaporanPath;
		if (fotoKeluhanPath) updateDataPayload.FOTO_KELUHAN = fotoKeluhanPath;

		const updated = await updatePengaduan(updateDataPayload);

		const enriched = await enrichPengaduan(updated);
		return res.status(200).json({
			success: true,
			message: "Data pelanggan dan pengaduan berhasil diperbarui",
			data: formatPengaduanFiles(req, enriched),
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

		const formattedData = enriched.map((item) => formatPengaduanFiles(req, item));

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

const serveUploadedFile = (res, filePath) => {
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

const serveDatabaseFile = (res, data, mimeType, fileName) => {
	if (data == null) return null;

	res.setHeader("Content-Type", mimeType || "application/octet-stream");
	res.setHeader(
		"Content-Disposition",
		`inline; filename*=UTF-8''${encodeURIComponent(path.basename(fileName || "file"))}`,
	);
	res.setHeader("X-Content-Type-Options", "nosniff");
	return res.send(Buffer.from(data));
};

export const viewPengaduanFile = async (req, res, next) => {
	try {
		const { id, fileId } = req.params;

		if (fileId === "legacy-dokumen" || fileId === "legacy-foto") {
			const legacy = await prisma.TABEL_PENGADUAN_FILE.findUnique({
				where: { ID_PENGADUAN: id },
			});
			const isDocument = fileId === "legacy-dokumen";
			const served = serveDatabaseFile(
				res,
				isDocument ? legacy?.DOKUMEN_LAPORAN_DATA : legacy?.FOTO_KELUHAN_DATA,
				isDocument ? legacy?.DOKUMEN_LAPORAN_MIME : legacy?.FOTO_KELUHAN_MIME,
				isDocument ? legacy?.DOKUMEN_LAPORAN_NAMA : legacy?.FOTO_KELUHAN_NAMA,
			);
			if (served) return served;
			return res.status(404).json({ success: false, message: "File tidak ditemukan" });
		}

		const file = await prisma.TABEL_PENGADUAN_FILE_ITEM.findFirst({
			where: { ID_FILE: fileId, ID_PENGADUAN: id },
		});
		if (!file) {
			return res.status(404).json({ success: false, message: "File tidak ditemukan" });
		}

		return serveDatabaseFile(res, file.FILE_DATA, file.MIME_TYPE, file.NAMA_FILE);
	} catch (error) {
		next(error);
	}
};

export const deletePengaduanFile = async (req, res, next) => {
	try {
		const { id, fileId } = req.params;
		const pengaduan = await prisma.TABEL_PENGADUAN.findUnique({
			where: { ID_PENGADUAN: id },
			select: {
				DOKUMEN_LAPORAN: true,
				FOTO_KELUHAN: true,
			},
		});

		if (!pengaduan) {
			return res.status(404).json({ success: false, message: "Data pengaduan tidak ditemukan" });
		}

		const file = await prisma.TABEL_PENGADUAN_FILE_ITEM.findFirst({
			where: { ID_FILE: fileId, ID_PENGADUAN: id },
			select: { ID_FILE: true, JENIS_FILE: true },
		});
		if (!file) {
			return res.status(404).json({ success: false, message: "File tidak ditemukan" });
		}
		if (!["dokumenLaporan", "fotoKeluhan"].includes(file.JENIS_FILE)) {
			return res.status(409).json({ success: false, message: "Jenis file tidak didukung untuk dihapus" });
		}

		const deleted = await prisma.$transaction(async (tx) => {
			const result = await tx.TABEL_PENGADUAN_FILE_ITEM.deleteMany({
				where: { ID_FILE: fileId, ID_PENGADUAN: id },
			});
			if (result.count !== 1) return false;

			const isDocument = file.JENIS_FILE === "dokumenLaporan";
			const field = isDocument ? "DOKUMEN_LAPORAN" : "FOTO_KELUHAN";
			const currentPath = isDocument ? pengaduan.DOKUMEN_LAPORAN : pengaduan.FOTO_KELUHAN;
			if (currentPath === fileEndpoint(id, fileId)) {
				const nextFile = await tx.TABEL_PENGADUAN_FILE_ITEM.findFirst({
					where: { ID_PENGADUAN: id, JENIS_FILE: file.JENIS_FILE },
					orderBy: [{ CREATED_AT: "asc" }, { ID_FILE: "asc" }],
					select: { ID_FILE: true },
				});
				const legacyFile = await tx.TABEL_PENGADUAN_FILE.findUnique({
					where: { ID_PENGADUAN: id },
					select: isDocument
						? { DOKUMEN_LAPORAN_MIME: true, DOKUMEN_LAPORAN_NAMA: true }
						: { FOTO_KELUHAN_MIME: true, FOTO_KELUHAN_NAMA: true },
				});
				const hasLegacyFile = isDocument
					? Boolean(legacyFile?.DOKUMEN_LAPORAN_MIME || legacyFile?.DOKUMEN_LAPORAN_NAMA)
					: Boolean(legacyFile?.FOTO_KELUHAN_MIME || legacyFile?.FOTO_KELUHAN_NAMA);
				const nextPath = nextFile
					? fileEndpoint(id, nextFile.ID_FILE)
					: hasLegacyFile
						? `/api/pelanggan/${id}/${isDocument ? "dokumen" : "foto"}`
						: null;

				await tx.TABEL_PENGADUAN.update({
					where: { ID_PENGADUAN: id },
					data: { [field]: nextPath },
				});
			}

			return true;
		});

		if (!deleted) {
			return res.status(404).json({ success: false, message: "File tidak ditemukan" });
		}

		return res.status(200).json({
			success: true,
			message: "File berhasil dihapus",
			data: { idFile: file.ID_FILE, type: file.JENIS_FILE },
		});
	} catch (error) {
		next(error);
	}
};

export const viewDokumenLaporan = async (req, res, next) => {
	try {
		const { id } = req.params;

		const [pengaduan, uploadedFile] = await Promise.all([
			prisma.TABEL_PENGADUAN.findUnique({
				where: { ID_PENGADUAN: id },
				select: { DOKUMEN_LAPORAN: true },
			}),
			prisma.TABEL_PENGADUAN_FILE.findUnique({
				where: { ID_PENGADUAN: id },
				select: {
					DOKUMEN_LAPORAN_DATA: true,
					DOKUMEN_LAPORAN_MIME: true,
					DOKUMEN_LAPORAN_NAMA: true,
				},
			}),
		]);

		if (!pengaduan) {
			return res.status(404).json({ success: false, message: "Data pengaduan tidak ditemukan" });
		}

		const latestFile = await prisma.TABEL_PENGADUAN_FILE_ITEM.findFirst({
			where: { ID_PENGADUAN: id, JENIS_FILE: "dokumenLaporan" },
			orderBy: { CREATED_AT: "asc" },
		});
		if (latestFile) {
			return serveDatabaseFile(res, latestFile.FILE_DATA, latestFile.MIME_TYPE, latestFile.NAMA_FILE);
		}

		const databaseFile = serveDatabaseFile(
			res,
			uploadedFile?.DOKUMEN_LAPORAN_DATA,
			uploadedFile?.DOKUMEN_LAPORAN_MIME,
			uploadedFile?.DOKUMEN_LAPORAN_NAMA,
		);
		if (databaseFile) return databaseFile;

		return serveUploadedFile(res, pengaduan.DOKUMEN_LAPORAN);
	} catch (error) {
		next(error);
	}
};

export const viewFotoKeluhan = async (req, res, next) => {
	try {
		const { id } = req.params;

		const [pengaduan, uploadedFile] = await Promise.all([
			prisma.TABEL_PENGADUAN.findUnique({
				where: { ID_PENGADUAN: id },
				select: { FOTO_KELUHAN: true },
			}),
			prisma.TABEL_PENGADUAN_FILE.findUnique({
				where: { ID_PENGADUAN: id },
				select: {
					FOTO_KELUHAN_DATA: true,
					FOTO_KELUHAN_MIME: true,
					FOTO_KELUHAN_NAMA: true,
				},
			}),
		]);

		if (!pengaduan) {
			return res.status(404).json({ success: false, message: "Data pengaduan tidak ditemukan" });
		}

		const latestFile = await prisma.TABEL_PENGADUAN_FILE_ITEM.findFirst({
			where: { ID_PENGADUAN: id, JENIS_FILE: "fotoKeluhan" },
			orderBy: { CREATED_AT: "asc" },
		});
		if (latestFile) {
			return serveDatabaseFile(res, latestFile.FILE_DATA, latestFile.MIME_TYPE, latestFile.NAMA_FILE);
		}

		const databaseFile = serveDatabaseFile(
			res,
			uploadedFile?.FOTO_KELUHAN_DATA,
			uploadedFile?.FOTO_KELUHAN_MIME,
			uploadedFile?.FOTO_KELUHAN_NAMA,
		);
		if (databaseFile) return databaseFile;

		return serveUploadedFile(res, pengaduan.FOTO_KELUHAN);
	} catch (error) {
		next(error);
	}
};
