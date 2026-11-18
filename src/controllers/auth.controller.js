import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../config/db.js";

const JWT_SECRET = process.env.JWT_SECRET || "default_jwt_secret_key";
const JWT_EXPIRES_IN = "7d";

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
		const user = await prisma.tabelUser.findFirst({
			where: {
				OR: [
					{ username: userIdentifier },
					{ email: userIdentifier },
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
		if (user.password.startsWith("$2a$") || user.password.startsWith("$2b$")) {
			isMatch = await bcrypt.compare(password, user.password);
		} else {
			// Fallback jika password di db masih plaintext
			isMatch = user.password === password;
			// Jika cocok dan masih plaintext, otomatis hash untuk keamanan ke depan
			if (isMatch) {
				const hashedPassword = await bcrypt.hash(password, 10);
				await prisma.tabelUser.update({
					where: { idUser: user.idUser },
					data: { password: hashedPassword },
				});
			}
		}

		if (!isMatch) {
			return res.status(401).json({
				success: false,
				message: "Username/email atau password salah.",
			});
		}

		// Generate token JWT
		const tokenPayload = {
			idUser: user.idUser,
			namaUser: user.namaUser,
			email: user.email,
			username: user.username,
			role: user.role,
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
		const user = await prisma.tabelUser.findUnique({
			where: { idUser: req.user.idUser },
			select: {
				idUser: true,
				namaUser: true,
				email: true,
				username: true,
				role: true,
				createdAt: true,
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
			data: user,
		});
	} catch (error) {
		next(error);
	}
};

// 3. EDIT CURRENT USER PROFILE
export const updateProfile = async (req, res, next) => {
	try {
		const userId = req.user.idUser;
		const { namaUser, username, email, oldPassword, newPassword } = req.body;

		const user = await prisma.tabelUser.findUnique({
			where: { idUser: userId },
		});

		if (!user) {
			return res.status(404).json({
				success: false,
				message: "User tidak ditemukan.",
			});
		}

		const dataToUpdate = {};

		if (namaUser) dataToUpdate.namaUser = namaUser;

		// Cek keunikan username jika diubah
		if (username && username !== user.username) {
			const existingUsername = await prisma.tabelUser.findFirst({
				where: { username, NOT: { idUser: userId } },
			});
			if (existingUsername) {
				return res.status(400).json({
					success: false,
					message: "Username sudah digunakan oleh user lain.",
				});
			}
			dataToUpdate.username = username;
		}

		// Cek keunikan email jika diubah
		if (email && email !== user.email) {
			const existingEmail = await prisma.tabelUser.findFirst({
				where: { email, NOT: { idUser: userId } },
			});
			if (existingEmail) {
				return res.status(400).json({
					success: false,
					message: "Email sudah digunakan oleh user lain.",
				});
			}
			dataToUpdate.email = email;
		}

		// Jika ingin ubah password
		if (newPassword) {
			if (!oldPassword) {
				return res.status(400).json({
					success: false,
					message: "Password lama (oldPassword) wajib diisi untuk mengubah password.",
				});
			}

			let isMatch = false;
			if (user.password.startsWith("$2a$") || user.password.startsWith("$2b$")) {
				isMatch = await bcrypt.compare(oldPassword, user.password);
			} else {
				isMatch = user.password === oldPassword;
			}

			if (!isMatch) {
				return res.status(400).json({
					success: false,
					message: "Password lama tidak sesuai.",
				});
			}

			dataToUpdate.password = await bcrypt.hash(newPassword, 10);
		}

		if (Object.keys(dataToUpdate).length === 0) {
			return res.status(400).json({
				success: false,
				message: "Tidak ada data yang diperbarui.",
			});
		}

		const updatedUser = await prisma.tabelUser.update({
			where: { idUser: userId },
			data: dataToUpdate,
			select: {
				idUser: true,
				namaUser: true,
				email: true,
				username: true,
				role: true,
				createdAt: true,
			},
		});

		// Buat token baru jika username/nama/email berubah
		const tokenPayload = {
			idUser: updatedUser.idUser,
			namaUser: updatedUser.namaUser,
			email: updatedUser.email,
			username: updatedUser.username,
			role: updatedUser.role,
		};
		const newToken = jwt.sign(tokenPayload, JWT_SECRET, {
			expiresIn: JWT_EXPIRES_IN,
		});

		res.status(200).json({
			success: true,
			message: "Profil akun berhasil diperbarui",
			data: {
				user: updatedUser,
				token: newToken,
			},
		});
	} catch (error) {
		next(error);
	}
};

// 4. LOGOUT USER
export const logout = async (req, res) => {
	res.status(200).json({
		success: true,
		message: "Logout berhasil. Silakan hapus token di sisi klien/frontend.",
	});
};
