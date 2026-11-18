import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../config/db.js";

const JWT_SECRET = process.env.JWT_SECRET || "default_jwt_secret_key";
const JWT_EXPIRES_IN = "7d";

const toPublicUser = (user) => {
	if (!user) return null;
	return {
		idUser: user.ID_USER,
		namaUser: user.NAMA_USER,
		email: user.EMAIL,
		username: user.USERNAME,
		role: user.ROLE,
		createdAt: user.CREATED_AT,
	};
};

// 1. LOGIN USER
export const login = async (req, res, next) => {
	try {
		const { identifier, username, email, password } = req.body;
		const userIdentifier = identifier || username || email;

		if (!userIdentifier || !password) {
			return res.status(400).json({
				success: false,
				message: "Identifier (username/email) dan password wajib diisi.",
			});
		}

		// Cari user berdasarkan username ATAU email
		const user = await prisma.TABEL_USER.findFirst({
			where: {
				OR: [
					{ USERNAME: userIdentifier },
					{ EMAIL: userIdentifier },
				],
			},
		});

		if (!user) {
			return res.status(401).json({
				success: false,
				message: "Username/email atau password salah.",
			});
		}

		// Cek password: bisa bcrypt hash atau plain text (untuk user hasil seed lama)
		let isMatch = false;
		if (user.PASSWORD.startsWith("$2a$") || user.PASSWORD.startsWith("$2b$")) {
			isMatch = await bcrypt.compare(password, user.PASSWORD);
		} else {
			// Fallback jika password di db masih plaintext
			isMatch = user.PASSWORD === password;
			// Jika cocok dan masih plaintext, otomatis hash untuk keamanan ke depan
			if (isMatch) {
				const hashedPassword = await bcrypt.hash(password, 10);
				await prisma.TABEL_USER.update({
					where: { ID_USER: user.ID_USER },
					data: { PASSWORD: hashedPassword },
				});
			}
		}

		if (!isMatch) {
			return res.status(401).json({
				success: false,
				message: "Username/email atau password salah.",
			});
		}

		const publicUser = toPublicUser(user);

		// Generate token JWT
		const tokenPayload = {
			idUser: publicUser.idUser,
			namaUser: publicUser.namaUser,
			email: publicUser.email,
			username: publicUser.username,
			role: publicUser.role,
		};

		const token = jwt.sign(tokenPayload, JWT_SECRET, {
			expiresIn: JWT_EXPIRES_IN,
		});

		res.status(200).json({
			success: true,
			message: "Login berhasil",
			data: {
				user: tokenPayload,
				token,
			},
		});
	} catch (error) {
		next(error);
	}
};

// 2. GET CURRENT LOGGED IN USER PROFILE
export const getProfile = async (req, res, next) => {
	try {
		const user = await prisma.TABEL_USER.findUnique({
			where: { ID_USER: req.user.idUser },
			select: {
				ID_USER: true,
				NAMA_USER: true,
				EMAIL: true,
				USERNAME: true,
				ROLE: true,
				CREATED_AT: true,
			},
		});

		if (!user) {
			return res.status(404).json({
				success: false,
				message: "User tidak ditemukan.",
			});
		}

		res.status(200).json({
			success: true,
			data: toPublicUser(user),
		});
	} catch (error) {
		next(error);
	}
};

// 3. EDIT CURRENT USER PROFILE
export const updateProfile = async (req, res, next) => {
	try {
		const { namaUser, email, username, password } = req.body;

		const user = await prisma.TABEL_USER.findUnique({
			where: { ID_USER: req.user.idUser },
		});

		if (!user) {
			return res.status(404).json({
				success: false,
				message: "User tidak ditemukan.",
			});
		}

		const data = {};
		if (namaUser) data.NAMA_USER = namaUser;
		if (email) data.EMAIL = email;
		if (username) data.USERNAME = username;
		if (password) {
			data.PASSWORD = await bcrypt.hash(password, 10);
		}

		const updatedUser = await prisma.TABEL_USER.update({
			where: { ID_USER: req.user.idUser },
			data,
			select: {
				ID_USER: true,
				NAMA_USER: true,
				EMAIL: true,
				USERNAME: true,
				ROLE: true,
				CREATED_AT: true,
			},
		});

		res.status(200).json({
			success: true,
			message: "Profil berhasil diperbarui.",
			data: toPublicUser(updatedUser),
		});
	} catch (error) {
		next(error);
	}
};

// 4. FORGOT PASSWORD (placeholder - requires email/SMS infra)
export const forgotPassword = async (req, res, next) => {
	try {
		const { identifier } = req.body;
		if (!identifier) {
			return res.status(400).json({
				success: false,
				message: "Identifier (username/email) wajib diisi.",
			});
		}

		const user = await prisma.TABEL_USER.findFirst({
			where: {
				OR: [{ USERNAME: identifier }, { EMAIL: identifier }],
			},
		});

		// Selalu kirim respons sukses generik untuk mencegah user enumeration
		if (!user) {
			return res.status(200).json({
				success: true,
				message: "Jika akun ditemukan, instruksi reset password akan dikirim.",
			});
		}

		return res.status(200).json({
			success: true,
			message: "Jika akun ditemukan, instruksi reset password akan dikirim.",
		});
	} catch (error) {
		next(error);
	}
};

// 5. RESET PASSWORD (placeholder)
export const resetPassword = async (req, res, next) => {
	try {
		return res.status(501).json({
			success: false,
			message: "Reset password belum diimplementasikan.",
		});
	} catch (error) {
		next(error);
	}
};
