import { Router } from "express";
import {
	login,
	logout,
	getProfile,
	updateProfile,
	forgotPassword,
	resetPassword,
} from "../controllers/auth.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";

const router = Router();

router.post("/auth/login", login);
router.post("/auth/logout", authenticate, logout);
router.get("/auth/me", authenticate, getProfile);
router.put("/auth/profile", authenticate, updateProfile);
router.post("/auth/forgot-password", forgotPassword);
router.post("/auth/reset-password", resetPassword);

export default router;
