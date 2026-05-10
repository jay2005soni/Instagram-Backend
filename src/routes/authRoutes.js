const express = require("express");
const axios = require("axios");
const router = express.Router();

const { auth, db } = require("../config/firebase");

// SIGNUP API
router.post("/signup", async (req, res) => {
  try {
    const { email, password, username, fullName } = req.body;

    if (!email || !password || !username || !fullName) {
      return res.status(400).json({
        success: false,
        message: "email, password, username and fullName are required",
      });
    }

    const usernameDoc = await db.collection("usernames").doc(username).get();

    if (usernameDoc.exists) {
      return res.status(400).json({
        success: false,
        message: "Username already taken",
      });
    }

    const userRecord = await auth.createUser({
      email,
      password,
      displayName: fullName,
    });

    const uid = userRecord.uid;

    await db.collection("users").doc(uid).set({
      uid,
      email,
      username,
      fullName,
      bio: "",
      profileImage: "",
      followers: [],
      following: [],
      postsCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.collection("usernames").doc(username).set({
      uid,
      username,
      email,
    });

    const customToken = await auth.createCustomToken(uid);

    return res.status(201).json({
      success: true,
      message: "Signup successful",
      customToken,
      user: {
        uid,
        email,
        username,
        fullName,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
      code: error.code || null,
    });
  }
});

// LOGIN API
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "email and password are required",
      });
    }

    const apiKey = process.env.FIREBASE_WEB_API_KEY;

    const firebaseResponse = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        email,
        password,
        returnSecureToken: true,
      }
    );

    const { idToken, refreshToken, localId } = firebaseResponse.data;

    const userDoc = await db.collection("users").doc(localId).get();

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token: idToken,
      refreshToken,
      user: userDoc.exists ? userDoc.data() : null,
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      message:
        error.response?.data?.error?.message || error.message || "Login failed",
    });
  }
});

module.exports = router;