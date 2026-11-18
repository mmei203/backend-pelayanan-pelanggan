import bcrypt from "bcryptjs";
import { prisma } from "../config/db.js";

const mapUser = (u) => {
	if (!u) return null;
	return {
		idUser: u.ID_USER,
		namaUser: u.NAMA_USER,
		email: u.EMAIL,
		username: u.USERNAME,
		role: u.ROLE,
		createdAt: u.CREATED_AT,
	};
};

export const getAllUsers = async (req, res, next) => {
	try {
		const users = await prisma.TABEL_USER.findMany({
			select: {
				ID_USER: true,
				NAMA_USER: true,
				EMAIL: true,
				USERNAME: true,
				ROLE: true,
				CREATED_AT: true,
			},
			orderBy: { CREATED_AT: "desc" },
		});

		res.status(200).json({ success: true, data: users.map(mapUser) });
	} catch (error) {
		next(error);
	}
};

export const createUser = async (req, res, next) => {
	try {
		const { namaUser, email, username, password, role } = req.body;

		// Hash password sebelum disimpan jika belum di-hash
		let hashedPassword = password;
		if (password && !password.startsWith("$2a$") && !password.startsWith("$2b$")) {
			hashedPassword = await bcrypt.hash(password, 10);
		}

		const newUser = await prisma.TABEL_USER.create({
			data: {
				NAMA_USER: namaUser,
				EMAIL: email,
				USERNAME: username,
				PASSWORD: hashedPassword,
				ROLE: role,
				CREATED_AT: new Date(),
			},
			select: {
				ID_USER: true,
				NAMA_USER: true,
				EMAIL: true,
				USERNAME: true,
				ROLE: true,
				CREATED_AT: true,
			},
		});

		res.status(201).json({
			success: true,
			message: "User berhasil dibuat",
			data: mapUser(newUser),
		});
	} catch (error) {
		next(error);
	}
};

export const updateUser = async (req, res, next) => {
	try {
		const { id } = req.params;
		const { namaUser, email, username, password, role } = req.body;

		const userExist = await prisma.TABEL_USER.findUnique({
			where: { ID_USER: id },
		});

		if (!userExist) {
			return res
				.status(404)
				.json({ success: false, message: "User tidak ditemukan" });
		}

		const data = {};
		if (namaUser) data.NAMA_USER = namaUser;
		if (email) data.EMAIL = email;
		if (username) data.USERNAME = username;
		if (password) data.PASSWORD = password;
		if (role) data.ROLE = role;

		const updatedUser = await prisma.TABEL_USER.update({
			where: { ID_USER: id },
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
			message: "User berhasil diperbarui",
			data: mapUser(updatedUser),
		});
	} catch (error) {
		next(error);
	}
};
