export default async function handler(req, res) {
  try {
    const { db } =
      await import("../lib/firebase.js");

    const snapshot =
      await db
        .collection("_usdt_hub_test")
        .limit(1)
        .get();

    return res.status(200).json({
      success: true,
      firebase: true,
      documents: snapshot.size
    });

  } catch (error) {

    console.error(
      "FIREBASE TEST ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      firebase: false,
      error:
        error?.message ||
        String(error)
    });
  }
      }
