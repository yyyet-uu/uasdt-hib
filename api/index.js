export default function handler(req, res) {
  return res.status(200).json({
    success: true,
    message: "USDT Hub API is working",
    method: req.method,
    path: req.url
  });
}
