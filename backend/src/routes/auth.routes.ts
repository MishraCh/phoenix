import { Router } from "express";

import { authMiddleware } from "../auth/authMiddleware.js";
import { bootstrapAuthSession, getMe, forgotPassword } from "../controllers/authController.js";

export const authRouter = Router();

authRouter.get("/auth/me", authMiddleware, getMe);
authRouter.post("/auth/bootstrap", authMiddleware, bootstrapAuthSession);
authRouter.post("/auth/forgot-password", forgotPassword);
