import jwt from "jsonwebtoken";

export const authenticate = (req, res, next) => {
	try {
		const authHeader = req.headers.authorization;
		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return res.status(401).json({
				success: false,
				message: "Akses ditolak. Token tidak ditemukan atau format salah (Bearer <token>).",
			});
		}

		const token = authHeader.split(" ")[1];
		const secret = process.env.JWT_SECRET || "default_jwt_secret_key";

		const decoded = jwt.verify(token, secret);
		req.user = decoded; // { idUser, username, email, role, ... }
		next();
	} catch (error) {
		return res.status(401).json({
			success: false,
			message: "Token tidak valid atau sudah kedaluwarsa.",
		});
	}
};
