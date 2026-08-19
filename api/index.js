module.exports = async (req, res) => {
  res.status(200).json({
    success: true,
    service: "USDT Hub API",
    status: "online"
  });
};
