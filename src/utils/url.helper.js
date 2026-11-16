export const formatFileUrl = (req, filePath) => {
	if (!filePath) return null;
	if (filePath.startsWith("http")) return filePath;

	const normalizedPath = filePath.replace(/\\/g, "/");
	// Jika file disimpan di /tmp (Vercel), ambil path relatif /uploads/...
	const uploadIndex = normalizedPath.indexOf("uploads/");
	const relativePath = uploadIndex !== -1 ? normalizedPath.slice(uploadIndex) : normalizedPath;

	return `${req.protocol}://${req.get("host")}/${relativePath}`;
};
