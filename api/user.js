import crypto from "node:crypto";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const { telegramId, firstName, username } = req.body || {};

    if (!telegramId) {
      return res.status(400).json({
        success: false,
        error: "Telegram ID is required"
      });
    }

    const serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT
    );

    const now = Math.floor(Date.now() / 1000);

    const header = {
      alg: "RS256",
      typ: "JWT"
    };

    const claim = {
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600
    };

    const base64url = (obj) =>
      Buffer.from(JSON.stringify(obj))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    const unsignedToken =
      `${base64url(header)}.${base64url(claim)}`;

    const signer = crypto.createSign("RSA-SHA256");
    signer.update(unsignedToken);

    const signature = signer
      .sign(serviceAccount.private_key)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const jwt = `${unsignedToken}.${signature}`;

    const tokenResponse = await fetch(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body:
          `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      console.error(tokenData);

      return res.status(500).json({
        success: false,
        error: "Firebase authentication failed"
      });
    }

    const projectId = serviceAccount.project_id;

    const documentId = String(telegramId);

    const firestoreUrl =
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(documentId)}`;

    const getUser = await fetch(firestoreUrl, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`
      }
    });

    if (getUser.status === 404) {
      const newUser = {
        fields: {
          telegramId: {
            stringValue: String(telegramId)
          },
          firstName: {
            stringValue: String(firstName || "")
          },
          username: {
            stringValue: String(username || "")
          },
          balance: {
            doubleValue: 0
          },
          createdAt: {
            integerValue: String(Date.now())
          }
        }
      };

      await fetch(firestoreUrl, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(newUser)
      });

      return res.status(200).json({
        success: true,
        message: "New user created",
        balance: 0
      });
    }

    const existingUser = await getUser.json();

    const balance =
      Number(
        existingUser.fields?.balance?.doubleValue ??
        existingUser.fields?.balance?.integerValue ??
        0
      );

    return res.status(200).json({
      success: true,
      message: "User loaded",
      balance
    });

  } catch (error) {
    console.error("USER API ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Backend error"
    });
  }
}
