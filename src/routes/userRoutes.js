const express = require("express");
const router = express.Router();

const verifyFirebaseToken = require("../middleware/authMiddleware");

const { db, admin } = require("../config/firebase");

router.post("/create-profile", verifyFirebaseToken, async (req, res) => {
  try {
    const { username, fullName, bio, profileImage } = req.body;
    const uid = req.user.uid;

    const userRef = db.collection("users").doc(uid);

    await userRef.set(
      {
        uid,
        username,
        fullName,
        email: req.user.email || "",
        bio: bio || "",
        profileImage: profileImage || "",
        followers: [],
        following: [],
        postsCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { merge: true }
    );

    res.status(201).json({
      success: true,
      message: "Profile created successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// SEARCH USERS BY USERNAME
router.get("/search", verifyFirebaseToken, async (req, res) => {
  try {
    const query = req.query.username;

    if (!query) {
      return res.status(400).json({
        success: false,
        message: "username query is required",
      });
    }

    const snapshot = await db
      .collection("users")
      .where("username", ">=", query)
      .where("username", "<=", query + "\uf8ff")
      .limit(20)
      .get();

    const users = [];

    snapshot.forEach((doc) => {
      const data = doc.data();

      users.push({
        uid: data.uid,
        username: data.username,
        fullName: data.fullName,
        profileImage: data.profileImage || "",
        bio: data.bio || "",
        followersCount: data.followers?.length || 0,
        followingCount: data.following?.length || 0,
        postsCount: data.postsCount || 0,
      });
    });

    return res.status(200).json({
      success: true,
      count: users.length,
      users,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.post("/follow-request/:targetUid", verifyFirebaseToken, async (req, res) => {
  try {
    const senderUid = req.user.uid;
    const targetUid = req.params.targetUid;

    if (senderUid === targetUid) {
      return res.status(400).json({
        success: false,
        message: "You cannot follow yourself",
      });
    }

    const senderDoc = await db.collection("users").doc(senderUid).get();
    const targetDoc = await db.collection("users").doc(targetUid).get();

    if (!senderDoc.exists || !targetDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const sender = senderDoc.data();
    const target = targetDoc.data();

    if ((target.followers || []).includes(senderUid)) {
      return res.status(400).json({
        success: false,
        message: "Already following this user",
      });
    }

    const oldRequest = await db
      .collection("followRequests")
      .where("senderUid", "==", senderUid)
      .where("targetUid", "==", targetUid)
      .where("status", "==", "pending")
      .get();

    if (!oldRequest.empty) {
      return res.status(400).json({
        success: false,
        message: "Follow request already sent",
      });
    }

    const requestRef = await db.collection("followRequests").add({
      senderUid,
      targetUid,
      senderUsername: sender.username,
      senderFullName: sender.fullName,
      senderProfileImage: sender.profileImage || "",
      targetUsername: target.username,
      status: "pending",
      type: "follow_request",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.collection("notifications").add({
      receiverUid: targetUid,
      senderUid,
      type: "follow_request",
      requestId: requestRef.id,
      title: "New follow request",
      message: `${sender.username} requested to follow you`,
      isRead: false,
      createdAt: new Date(),
    });

    return res.status(201).json({
      success: true,
      message: "Follow request sent successfully",
      requestId: requestRef.id,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.get("/follow-requests", verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;

    const snapshot = await db
      .collection("followRequests")
      .where("targetUid", "==", uid)
      .where("status", "==", "pending")
      .get();

    const requests = [];

    snapshot.forEach((doc) => {
      requests.push({
        requestId: doc.id,
        ...doc.data(),
      });
    });

    return res.status(200).json({
      success: true,
      count: requests.length,
      requests,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.post("/follow-request/:requestId/accept", verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const requestId = req.params.requestId;

    const requestRef = db.collection("followRequests").doc(requestId);
    const requestDoc = await requestRef.get();

    if (!requestDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    const request = requestDoc.data();

    if (request.targetUid !== uid) {
      return res.status(403).json({
        success: false,
        message: "You cannot accept this request",
      });
    }

    if (request.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Request already handled",
      });
    }

    await db.runTransaction(async (transaction) => {
      const senderRef = db.collection("users").doc(request.senderUid);
      const targetRef = db.collection("users").doc(request.targetUid);

      transaction.update(senderRef, {
        following: admin.firestore.FieldValue.arrayUnion(request.targetUid),
        updatedAt: new Date(),
      });

      transaction.update(targetRef, {
        followers: admin.firestore.FieldValue.arrayUnion(request.senderUid),
        updatedAt: new Date(),
      });

      transaction.update(requestRef, {
        status: "accepted",
        updatedAt: new Date(),
      });
    });

    await db.collection("notifications").add({
      receiverUid: request.senderUid,
      senderUid: request.targetUid,
      type: "follow_accept",
      title: "Follow request accepted",
      message: `${request.targetUsername} accepted your follow request`,
      isRead: false,
      createdAt: new Date(),
    });

    return res.status(200).json({
      success: true,
      message: "Follow request accepted successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});


router.post("/follow-request/:requestId/reject", verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const requestId = req.params.requestId;

    const requestRef = db.collection("followRequests").doc(requestId);
    const requestDoc = await requestRef.get();

    if (!requestDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    const request = requestDoc.data();

    if (request.targetUid !== uid) {
      return res.status(403).json({
        success: false,
        message: "You cannot reject this request",
      });
    }

    await requestRef.update({
      status: "rejected",
      updatedAt: new Date(),
    });

    return res.status(200).json({
      success: true,
      message: "Follow request rejected",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});


router.get("/notifications", verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;

    const snapshot = await db
      .collection("notifications")
      .where("receiverUid", "==", uid)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const notifications = [];

    snapshot.forEach((doc) => {
      notifications.push({
        notificationId: doc.id,
        ...doc.data(),
      });
    });

    return res.status(200).json({
      success: true,
      count: notifications.length,
      notifications,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.post("/request/:targetUid", verifyFirebaseToken, async (req, res) => {
  try {
    const senderUid = req.user.uid;
    const targetUid = req.params.targetUid;

    if (senderUid === targetUid) {
      return res.status(400).json({
        success: false,
        message: "You cannot send request to yourself",
      });
    }

    const senderDoc = await db.collection("users").doc(senderUid).get();
    const targetDoc = await db.collection("users").doc(targetUid).get();

    if (!targetDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Target user not found",
      });
    }

    const existingRequest = await db
      .collection("friendRequests")
      .where("senderUid", "==", senderUid)
      .where("targetUid", "==", targetUid)
      .where("status", "==", "pending")
      .get();

    if (!existingRequest.empty) {
      return res.status(400).json({
        success: false,
        message: "Request already sent",
      });
    }

    const requestRef = await db.collection("friendRequests").add({
      senderUid,
      targetUid,
      senderUsername: senderDoc.data().username,
      senderFullName: senderDoc.data().fullName,
      senderProfileImage: senderDoc.data().profileImage || "",
      targetUsername: targetDoc.data().username,
      targetFullName: targetDoc.data().fullName,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return res.status(201).json({
      success: true,
      message: "Friend request sent successfully",
      requestId: requestRef.id,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});


router.get("/requests", verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;

    const snapshot = await db
      .collection("friendRequests")
      .where("targetUid", "==", uid)
      .where("status", "==", "pending")
      .get();

    const requests = [];

    snapshot.forEach((doc) => {
      requests.push({
        requestId: doc.id,
        ...doc.data(),
      });
    });

    return res.status(200).json({
      success: true,
      count: requests.length,
      requests,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});


router.post("/request/:requestId/accept", verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const requestId = req.params.requestId;

    const requestRef = db.collection("friendRequests").doc(requestId);
    const requestDoc = await requestRef.get();

    if (!requestDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    const request = requestDoc.data();

    if (request.targetUid !== uid) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to accept this request",
      });
    }

    if (request.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Request already handled",
      });
    }

    await db.runTransaction(async (transaction) => {
      const senderRef = db.collection("users").doc(request.senderUid);
      const targetRef = db.collection("users").doc(request.targetUid);

      transaction.update(senderRef, {
        following: admin.firestore.FieldValue.arrayUnion(request.targetUid),
        updatedAt: new Date(),
      });

      transaction.update(targetRef, {
        followers: admin.firestore.FieldValue.arrayUnion(request.senderUid),
        updatedAt: new Date(),
      });

      transaction.update(requestRef, {
        status: "accepted",
        updatedAt: new Date(),
      });
    });

    return res.status(200).json({
      success: true,
      message: "Friend request accepted successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});


router.post("/request/:requestId/reject", verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const requestId = req.params.requestId;

    const requestRef = db.collection("friendRequests").doc(requestId);
    const requestDoc = await requestRef.get();

    if (!requestDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    const request = requestDoc.data();

    if (request.targetUid !== uid) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to reject this request",
      });
    }

    await requestRef.update({
      status: "rejected",
      updatedAt: new Date(),
    });

    return res.status(200).json({
      success: true,
      message: "Friend request rejected successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});
router.get("/profile", verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;

    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "User profile not found",
      });
    }

    const user = userDoc.data();

    const postsSnapshot = await db
      .collection("posts")
      .where("userId", "==", uid)
      .orderBy("createdAt", "desc")
      .get();

    const posts = [];

    postsSnapshot.forEach((doc) => {
      const data = doc.data();

      posts.push({
        postId: doc.id,
        userId: data.userId,
        username: data.username,
        fullName: data.fullName,
        caption: data.caption || "",
        imageUrl: data.imageUrl || "",
        imagePublicId: data.imagePublicId || "",
        likes: data.likes || [],
        likesCount: data.likesCount || 0,
        commentsCount: data.commentsCount || 0,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      });
    });

    return res.status(200).json({
      success: true,
      profile: {
        uid: user.uid,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        bio: user.bio || "",
        profileImage: user.profileImage || "",
        followers: user.followers || [],
        following: user.following || [],
        followersCount: user.followers?.length || 0,
        followingCount: user.following?.length || 0,
        postsCount: posts.length,
      },
      posts: posts,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});
router.get("/me", verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;

    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "User profile not found",
      });
    }

    res.status(200).json({
      success: true,
      user: userDoc.data(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;