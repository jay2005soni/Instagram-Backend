const express = require("express");
const multer = require("multer");
const streamifier = require("streamifier");

const verifyFirebaseToken = require("../middleware/authMiddleware");
const { db, admin } = require("../config/firebase");
const cloudinary = require("../config/cloudinary");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const uploadToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "instagram_clone/posts" },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );

    streamifier.createReadStream(buffer).pipe(stream);
  });
};

// CREATE POST
router.post("/create", verifyFirebaseToken, upload.single("image"), async (req, res) => {
  try {
    const uid = req.user.uid;
    const { caption } = req.body;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Image is required",
      });
    }

    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "User profile not found",
      });
    }

    const user = userDoc.data();

    const uploadedImage = await uploadToCloudinary(req.file.buffer);

    const postRef = await db.collection("posts").add({
      userId: uid,
      username: user.username,
      fullName: user.fullName,
      userProfileImage: user.profileImage || "",
      caption: caption || "",
      imageUrl: uploadedImage.secure_url,
      imagePublicId: uploadedImage.public_id,
      likes: [],
      likesCount: 0,
      commentsCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.collection("users").doc(uid).update({
      postsCount: admin.firestore.FieldValue.increment(1),
      updatedAt: new Date(),
    });

    return res.status(201).json({
      success: true,
      message: "Post created successfully",
      postId: postRef.id,
      post: {
        postId: postRef.id,
        imageUrl: uploadedImage.secure_url,
        caption: caption || "",
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// GET MY POSTS
router.get("/my-posts", verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;

    const snapshot = await db
      .collection("posts")
      .where("userId", "==", uid)
      .orderBy("createdAt", "desc")
      .get();

    const posts = [];

    snapshot.forEach((doc) => {
      posts.push({
        postId: doc.id,
        ...doc.data(),
      });
    });

    return res.status(200).json({
      success: true,
      count: posts.length,
      posts,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// GET ANY USER PROFILE WITH POSTS
router.get("/user/:uid", verifyFirebaseToken, async (req, res) => {
  try {
    const profileUid = req.params.uid;

    const userDoc = await db.collection("users").doc(profileUid).get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const postsSnapshot = await db
      .collection("posts")
      .where("userId", "==", profileUid)
      .orderBy("createdAt", "desc")
      .get();

    const posts = [];

    postsSnapshot.forEach((doc) => {
      posts.push({
        postId: doc.id,
        ...doc.data(),
      });
    });

    return res.status(200).json({
      success: true,
      profile: userDoc.data(),
      postsCount: posts.length,
      posts,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// HOME FEED
router.get("/feed", verifyFirebaseToken, async (req, res) => {
  try {
    const snapshot = await db
      .collection("posts")
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const posts = [];

    snapshot.forEach((doc) => {
      posts.push({
        postId: doc.id,
        ...doc.data(),
      });
    });

    return res.status(200).json({
      success: true,
      count: posts.length,
      posts,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;