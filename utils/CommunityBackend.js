import {
  getDocs,
  collection,
  query,
  where,
  doc,
  updateDoc,
  arrayUnion,
  getDoc,
  addDoc,
  serverTimestamp,
  limit,
  orderBy,
  setDoc,
  onSnapshot,
  Timestamp,
  documentId,
  writeBatch,
} from "firebase/firestore"
import { db, auth } from "../firebaseConfig"
import AsyncStorage from "@react-native-async-storage/async-storage"
import NotificationService from "../services/NotificationService"

// Default avatar image to use when user has no avatar
const DEFAULT_AVATAR = "https://res.cloudinary.com/dljywnlvh/image/upload/v1747077348/default-avatar_jkbpwv.jpg"

// Cache TTL in milliseconds (30 minutes)
const CACHE_TTL = 30 * 60 * 1000

// Activity types with their configurations
export const ACTIVITY_TYPES = [
  {
    id: "walking",
    name: "Walking",
    icon: "walk-outline",
    color: "#4361EE",
    defaultGoal: 5,
    unit: "km",
    goalOptions: [2, 3, 5, 8, 10],
  },
  {
    id: "running",
    name: "Running",
    icon: "fitness-outline",
    color: "#EF476F",
    defaultGoal: 3,
    unit: "km",
    goalOptions: [1, 2, 3, 5, 8],
  },
  {
    id: "cycling",
    name: "Cycling",
    icon: "bicycle-outline",
    color: "#06D6A0",
    defaultGoal: 10,
    unit: "km",
    goalOptions: [5, 10, 15, 20, 30],
  },
  {
    id: "pushup",
    name: "Push-ups",
    icon: "fitness-outline",
    color: "#9B5DE5",
    defaultGoal: 50,
    unit: "reps",
    goalOptions: [20, 30, 50, 75, 100],
  },
  {
    id: "squat",
    name: "Squats",
    icon: "fitness-outline",
    color: "#F15BB5",
    defaultGoal: 50,
    unit: "reps",
    goalOptions: [25, 40, 50, 75, 100],
  },
  {
    id: "situp",
    name: "Sit-ups",
    icon: "fitness-outline",
    color: "#00BBF9",
    defaultGoal: 40,
    unit: "reps",
    goalOptions: [20, 30, 40, 60, 80],
  },
]

// Difficulty levels
export const DIFFICULTY_LEVELS = [
  { id: "easy", name: "Easy", multiplier: 0.7, color: "#06D6A0", icon: "leaf-outline" },
  { id: "medium", name: "Medium", multiplier: 1.0, color: "#FFC107", icon: "flame-outline" },
  { id: "hard", name: "Hard", multiplier: 1.5, color: "#EF476F", icon: "flash-outline" },
  { id: "extreme", name: "Extreme", multiplier: 2.0, color: "#9B5DE5", icon: "skull-outline" },
]

// Helper function to serialize user objects for Firestore
export const serializeUserForFirestore = (user) => {
  if (!user) return null
  return {
    id: user.id,
    username: user.username || "",
    displayName: user.displayName || "",
    avatar: user.avatar || DEFAULT_AVATAR,
    email: user.email || "",
  }
}

// Cache helper functions
export const getCachedData = async (key) => {
  try {
    const cachedData = await AsyncStorage.getItem(key)
    if (cachedData) {
      const { data, timestamp } = JSON.parse(cachedData)
      if (Date.now() - timestamp < CACHE_TTL) {
        return data
      }
    }
    return null
  } catch (error) {
    console.warn("Error reading from cache:", error)
    return null
  }
}

export const setCachedData = async (key, data) => {
  try {
    const cacheItem = {
      data,
      timestamp: Date.now(),
    }
    await AsyncStorage.setItem(key, JSON.stringify(cacheItem))
  } catch (error) {
    console.warn("Error writing to cache:", error)
  }
}

// User Profile Management
export const loadUserProfile = async (callbacks) => {
  const { setUserProfile, setFriends, setError, setLoading, setInitialLoadComplete } = callbacks
  const user = auth.currentUser
  if (!user) return

  setLoading(true)
  setError(null)

  try {
    const cachedProfile = await getCachedData(`userProfile_${user.uid}`)
    if (cachedProfile) {
      setUserProfile(cachedProfile)
      loadInitialFriends(cachedProfile.friends || [], callbacks)
    }

    const userDocRef = doc(db, "users", user.uid)
    const userListener = onSnapshot(
      userDocRef,
      async (docSnapshot) => {
        try {
          if (docSnapshot.exists()) {
            const userData = docSnapshot.data()
            const profileData = { id: user.uid, ...userData }
            setUserProfile(profileData)
            await setCachedData(`userProfile_${user.uid}`, profileData)
            loadInitialFriends(userData.friends || [], callbacks)
          } else {
            const newUserData = {
              username: user.displayName || user.email.split("@")[0],
              email: user.email,
              avatar: DEFAULT_AVATAR,
              friends: [],
              createdAt: serverTimestamp(),
            }
            await setDoc(userDocRef, newUserData)
            const profileData = { id: user.uid, ...newUserData }
            setUserProfile(profileData)
            setFriends([])
            await setCachedData(`userProfile_${user.uid}`, profileData)
          }
        } catch (err) {
          console.error("Error in user profile listener:", err)
          setError("Failed to load user profile.")
        } finally {
          setLoading(false)
          setInitialLoadComplete(true)
        }
      },
      (error) => {
        console.error("Error in user profile snapshot:", error)
        setError("Failed to load user profile.")
        setLoading(false)
        setInitialLoadComplete(true)
      },
    )

    return userListener
  } catch (err) {
    console.error("Error loading initial data:", err)
    setError("Failed to load data. Please check your connection.")
    setLoading(false)
    setInitialLoadComplete(true)
    return null
  }
}

// Friends Management
export const loadInitialFriends = async (friendIds, callbacks) => {
  const { setFriends, setHasMoreFriends, setFriendsPage } = callbacks
  const friendsPerPage = 5

  if (!friendIds || friendIds.length === 0) {
    setFriends([])
    setHasMoreFriends(false)
    return
  }

  try {
    setFriendsPage(1)
    setHasMoreFriends(friendIds.length > friendsPerPage)

    const cachedFriends = await getCachedData("friends")
    if (cachedFriends) {
      const validCachedFriends = cachedFriends.filter((friend) => friendIds.includes(friend.id))
      if (validCachedFriends.length > 0) {
        setFriends(validCachedFriends)
        loadFriendsPage(friendIds, 1, true, callbacks)
        return
      }
    }

    await loadFriendsPage(friendIds, 1, false, callbacks)
  } catch (err) {
    console.error("Error loading initial friends:", err)
  }
}

export const loadFriendsPage = async (allFriendIds, page, isBackgroundRefresh = false, callbacks) => {
  const { setFriends, setHasMoreFriends, setFriendsPage, setLoadingMoreFriends } = callbacks
  const friendsPerPage = 5

  if (!allFriendIds || allFriendIds.length === 0) {
    setFriends([])
    setHasMoreFriends(false)
    return
  }

  if (!isBackgroundRefresh) {
    setLoadingMoreFriends(true)
  }

  try {
    const startIndex = (page - 1) * friendsPerPage
    const endIndex = startIndex + friendsPerPage
    const pageIds = allFriendIds.slice(startIndex, endIndex)

    if (pageIds.length === 0) {
      setHasMoreFriends(false)
      setLoadingMoreFriends(false)
      return
    }

    const friendsData = []
    const chunks = []
    for (let i = 0; i < pageIds.length; i += 10) {
      chunks.push(pageIds.slice(i, i + 10))
    }

    for (const chunk of chunks) {
      const friendsQuery = query(collection(db, "users"), where(documentId(), "in", chunk))
      const friendsSnapshot = await getDocs(friendsQuery)

      for (const friendDoc of friendsSnapshot.docs) {
        const friendData = {
          id: friendDoc.id,
          ...friendDoc.data(),
          lastActivity: null,
          streak: 0,
          totalDistance: 0,
          totalActivities: 0,
          isOnline: friendDoc.data().isOnline || false,
        }
        friendsData.push(friendData)
        loadFriendActivities(friendDoc.id, friendData, callbacks)
      }
    }

    if (page === 1) {
      setFriends(friendsData)
    } else {
      setFriends((prev) => [...prev, ...friendsData])
    }

    if (page === 1) {
      const allCachedFriends = (await getCachedData("friends")) || []
      const updatedCache = [...friendsData, ...allCachedFriends.filter((f) => !pageIds.includes(f.id))]
      await setCachedData("friends", updatedCache)
    }

    setFriendsPage(page)
    setHasMoreFriends(endIndex < allFriendIds.length)
  } catch (err) {
    console.error("Error loading friends page:", err)
  } finally {
    setLoadingMoreFriends(false)
  }
}

export const loadFriendActivities = async (friendId, friendData, callbacks) => {
  const { setFriends } = callbacks

  try {
    const cacheKey = `friendActivities_${friendId}`
    const cachedActivities = await getCachedData(cacheKey)
    if (cachedActivities) {
      updateFriendWithActivity(friendId, cachedActivities[0], cachedActivities.length, setFriends)
    }

    const activitiesRef = collection(db, "activities")
    const activitiesQuery = query(
      activitiesRef,
      where("userId", "==", friendId),
      orderBy("createdAt", "desc"),
      limit(5),
    )
    const activitiesSnapshot = await getDocs(activitiesQuery)

    let activities = []
    if (!activitiesSnapshot.empty) {
      activities = activitiesSnapshot.docs.map((doc) => {
        const data = doc.data()
        return {
          id: doc.id,
          ...data,
          distance: typeof data.distance === "number" && !isNaN(data.distance) ? data.distance : 0,
        }
      })
      await setCachedData(cacheKey, activities)
      updateFriendWithActivity(friendId, activities[0], activities.length, setFriends)
    } else {
      updateFriendWithActivity(friendId, null, 0, setFriends)
    }
  } catch (err) {
    console.warn(`Error loading activities for friend ${friendId}:`, err)
  }
}

const updateFriendWithActivity = (friendId, activity, activityCount, setFriends) => {
  setFriends((prevFriends) => {
    return prevFriends.map((f) => {
      if (f.id === friendId) {
        return {
          ...f,
          lastActivity: activity || null,
          streak: activity ? 1 : 0,
          totalDistance: activity && typeof activity.distance === "number" ? activity.distance : 0,
          totalActivities: activityCount || 0,
        }
      }
      return f
    })
  })
}

// Friend Requests Management
export const loadFriendRequests = async (userId, callbacks) => {
  const { setFriendRequests, setError } = callbacks

  try {
    const cachedRequests = await getCachedData(`friendRequests_${userId}`)
    if (cachedRequests) {
      setFriendRequests(cachedRequests)
    }

    const requestsRef = collection(db, "friendRequests")
    const requestsQuery = query(requestsRef, where("to", "==", userId), where("status", "==", "pending"))

    const requestsListener = onSnapshot(
      requestsQuery,
      async (querySnapshot) => {
        try {
          const requestsData = []
          const requestPromises = []
          const userCache = {}

          for (const requestDoc of querySnapshot.docs) {
            const requestData = requestDoc.data()
            const promise = (async () => {
              try {
                if (!userCache[requestData.from]) {
                  const fromUserDoc = await getDoc(doc(db, "users", requestData.from))
                  if (fromUserDoc.exists()) {
                    userCache[requestData.from] = fromUserDoc.data()
                  }
                }

                if (userCache[requestData.from]) {
                  const fromUserData = userCache[requestData.from]
                  const mutualFriends = 0
                  requestsData.push({
                    id: requestDoc.id,
                    ...requestData,
                    fromUser: { id: requestData.from, ...fromUserData },
                    mutualFriends,
                  })
                }
              } catch (err) {
                console.warn(`Error processing friend request ${requestDoc.id}:`, err)
              }
            })()
            requestPromises.push(promise)
          }

          await Promise.all(requestPromises)
          setFriendRequests(requestsData)
          await setCachedData(`friendRequests_${userId}`, requestsData)
        } catch (err) {
          console.error("Error processing friend requests:", err)
          setError("Failed to load friend requests.")
        }
      },
      (error) => {
        console.error("Error in friend requests listener:", error)
        setError("Failed to load friend requests.")
      },
    )

    return requestsListener
  } catch (err) {
    console.error("Error setting up friend requests listener:", err)
    return null
  }
}

export const sendFriendRequest = async (userId) => {
  try {
    const user = auth.currentUser

    // Check if request already exists
    const requestsRef = collection(db, "friendRequests")
    const existingRequestQuery = query(
      requestsRef,
      where("from", "==", user.uid),
      where("to", "==", userId),
      where("status", "==", "pending"),
    )
    const existingRequestSnapshot = await getDocs(existingRequestQuery)

    if (!existingRequestSnapshot.empty) {
      throw new Error("You've already sent a friend request to this user.")
    }

    // Add friend request to database
    const requestDoc = await addDoc(requestsRef, {
      from: user.uid,
      to: userId,
      status: "pending",
      createdAt: serverTimestamp(),
    })

    // Get current user data for notification
    const currentUserDoc = await getDoc(doc(db, "users", user.uid))
    const currentUserData = currentUserDoc.data()

    // Send notification using the real NotificationService
    try {
      const notificationId = await NotificationService.sendFriendRequestNotification(
        userId,
        {
          id: user.uid,
          username: currentUserData.username || currentUserData.displayName,
          displayName: currentUserData.displayName || currentUserData.username,
          avatar: currentUserData.avatar || DEFAULT_AVATAR,
        },
        requestDoc.id,
      )

      if (notificationId) {
        console.log(`✅ Friend request notification sent: ${notificationId}`)
      } else {
        console.warn("⚠️ Failed to send friend request notification")
      }
    } catch (notificationError) {
      console.error("❌ Error sending friend request notification:", notificationError)
      // Don't fail the entire operation if notification fails
    }

    return { success: true, message: "Friend request sent successfully!" }
  } catch (err) {
    console.error("Error sending friend request:", err)
    throw new Error(err.message || "Failed to send friend request. Please try again.")
  }
}

export const acceptFriendRequest = async (requestId, fromUserId, callbacks) => {
  const { setFriendRequests, setUserProfile, setFriends } = callbacks

  try {
    const user = auth.currentUser
    const requestRef = doc(db, "friendRequests", requestId)
    const requestDoc = await getDoc(requestRef)

    if (!requestDoc.exists()) {
      throw new Error("Friend request not found. It may have been deleted or already processed.")
    }

    const currentUserRef = doc(db, "users", user.uid)
    const fromUserRef = doc(db, "users", fromUserId)
    const [currentUserDoc, fromUserDoc] = await Promise.all([getDoc(currentUserRef), getDoc(fromUserRef)])

    if (!currentUserDoc.exists()) {
      throw new Error("Your user profile could not be found. Please try refreshing the app.")
    }
    if (!fromUserDoc.exists()) {
      throw new Error("The other user's profile could not be found. They may have deleted their account.")
    }

    await updateDoc(requestRef, {
      status: "accepted",
      updatedAt: serverTimestamp(),
    })

    const currentUserFriends = currentUserDoc.data().friends || []
    if (!currentUserFriends.includes(fromUserId)) {
      await updateDoc(currentUserRef, {
        friends: [...currentUserFriends, fromUserId],
      })
    }

    try {
      const fromUserFriends = fromUserDoc.data().friends || []
      if (!fromUserFriends.includes(user.uid)) {
        await updateDoc(fromUserRef, {
          friends: [...fromUserFriends, user.uid],
        })
      }
    } catch (updateError) {
      console.error("Error updating friend's document:", updateError)
    }

    try {
      const chatRoomId = [user.uid, fromUserId].sort().join("_")
      const chatRoomRef = doc(db, "chatRooms", chatRoomId)
      const chatRoomDoc = await getDoc(chatRoomRef)

      if (!chatRoomDoc.exists()) {
        await setDoc(chatRoomRef, {
          participants: [user.uid, fromUserId],
          createdAt: serverTimestamp(),
          lastMessage: null,
          lastMessageTime: null,
        })
      }
    } catch (err) {
      console.warn("Could not create chat room:", err)
    }

    setFriendRequests((prev) => prev.filter((req) => req.id !== requestId))

    // Update user profile and friends list
    setUserProfile((prev) => ({
      ...prev,
      friends: [...(prev?.friends || []), fromUserId],
    }))

    const friendData = {
      id: fromUserId,
      ...fromUserDoc.data(),
      lastActivity: null,
      streak: 0,
      totalDistance: 0,
      totalActivities: 0,
      isOnline: fromUserDoc.data().isOnline || false,
    }
    setFriends((prev) => [friendData, ...prev])
    loadFriendActivities(fromUserId, friendData, { setFriends })

    return { success: true, message: "Friend request accepted!" }
  } catch (err) {
    console.error("Error accepting friend request:", err)
    let errorMessage = "Failed to accept friend request. Please try again."

    if (err.code === "permission-denied") {
      errorMessage = "You don't have permission to accept this friend request. Please check your account permissions."
    } else if (err.code === "not-found") {
      errorMessage = "The friend request or user profile could not be found. It may have been deleted."
    } else if (err.message) {
      errorMessage = err.message
    }

    throw new Error(errorMessage)
  }
}

export const rejectFriendRequest = async (requestId, callbacks) => {
  const { setFriendRequests } = callbacks

  try {
    const requestRef = doc(db, "friendRequests", requestId)
    await updateDoc(requestRef, {
      status: "rejected",
      updatedAt: serverTimestamp(),
    })

    setFriendRequests((prev) => prev.filter((req) => req.id !== requestId))
    return { success: true, message: "Friend request rejected." }
  } catch (err) {
    console.error("Error rejecting friend request:", err)
    throw new Error("Failed to reject friend request. Please try again.")
  }
}

// User Search
export const searchUsers = async (searchTerm) => {
  if (!searchTerm.trim()) {
    return []
  }

  try {
    const user = auth.currentUser
    const userDoc = await getDoc(doc(db, "users", user.uid))
    const userFriends = userDoc.data()?.friends || []

    const cacheKey = `search_${searchTerm.toLowerCase()}`
    const cachedResults = await getCachedData(cacheKey)
    if (cachedResults) {
      return cachedResults.map((result) => ({
        ...result,
        isFriend: userFriends.includes(result.id),
      }))
    }

    const usersRef = collection(db, "users")
    const usersSnapshot = await getDocs(query(usersRef, limit(20)))

    const results = []
    const lowerQuery = searchTerm.toLowerCase()

    for (const userDoc of usersSnapshot.docs) {
      if (userDoc.id === user.uid) continue

      const userData = userDoc.data()
      const displayName = userData.displayName || ""
      const username = userData.username || ""

      if (displayName.toLowerCase().includes(lowerQuery) || username.toLowerCase().includes(lowerQuery)) {
        const isFriend = userFriends.includes(userDoc.id)
        let requestSent = false

        if (!isFriend) {
          try {
            const requestsRef = collection(db, "friendRequests")
            const sentRequestQuery = query(
              requestsRef,
              where("from", "==", user.uid),
              where("to", "==", userDoc.id),
              where("status", "==", "pending"),
            )
            const sentRequestSnapshot = await getDocs(sentRequestQuery)
            requestSent = !sentRequestSnapshot.empty
          } catch (err) {
            console.warn("Error checking friend request status:", err)
          }
        }

        const isOnline = userData.isOnline || false
        results.push({
          id: userDoc.id,
          ...userData,
          isFriend,
          requestSent,
          isOnline,
        })
      }
    }

    await setCachedData(cacheKey, results)
    return results
  } catch (err) {
    console.error("Error searching users:", err)
    throw new Error("Error searching users. Please try again.")
  }
}

// Challenges Management
export const loadChallenges = async (callbacks) => {
  const { setChallenges } = callbacks

  try {
    const cachedChallenges = await getCachedData("challenges")
    if (cachedChallenges) {
      setChallenges(cachedChallenges)
    }

    const challengesRef = collection(db, "challenges")
    const challengesQuery = query(challengesRef, limit(5))
    const challengesSnapshot = await getDocs(challengesQuery)

    const now = new Date()
    const challengesData = challengesSnapshot.docs
      .map((doc) => ({
        id: doc.id,
        ...doc.data(),
        endDate: doc.data().endDate?.toDate() || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }))
      .filter((challenge) => challenge.endDate >= now)

    setChallenges(challengesData)
    await setCachedData("challenges", challengesData)

    const lastChallengeTime = challengesData.length > 0 ? challengesData[0].createdAt : Timestamp.fromDate(new Date(0))

    const newChallengesQuery = query(challengesRef, where("createdAt", ">", lastChallengeTime), limit(5))
    const challengesListener = onSnapshot(
      newChallengesQuery,
      (querySnapshot) => {
        if (querySnapshot.empty) return

        try {
          const now = new Date()
          const newChallengesData = querySnapshot.docs
            .map((doc) => ({
              id: doc.id,
              ...doc.data(),
              endDate: doc.data().endDate?.toDate() || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            }))
            .filter((challenge) => challenge.endDate >= now)

          if (newChallengesData.length > 0) {
            setChallenges((prev) => {
              const combined = [...newChallengesData, ...prev]
              const uniqueChallenges = combined.filter(
                (challenge, index, self) => index === self.findIndex((c) => c.id === challenge.id),
              )
              setCachedData("challenges", uniqueChallenges)
              return uniqueChallenges
            })
          }
        } catch (err) {
          console.error("Error processing challenges:", err)
        }
      },
      (error) => {
        console.error("Error in challenges listener:", error)
      },
    )

    return challengesListener
  } catch (err) {
    console.error("Error loading challenges:", err)
    return null
  }
}

export const createChallenge = async (challengeData, friendIds = []) => {
  try {
    if (!challengeData.title.trim()) {
      throw new Error("Please enter a challenge title")
    }

    const user = auth.currentUser
    const serializedFriendIds = friendIds.map((id) => String(id))

    const newChallengeData = {
      title: challengeData.title,
      description: challengeData.description,
      type: challengeData.type,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      endDate: Timestamp.fromDate(challengeData.endDate),
      isPublic: true,
      participants: [user.uid],
      invitedUsers: serializedFriendIds,
    }

    const challengeRef = await addDoc(collection(db, "challenges"), newChallengeData)

    // Get current user data for notifications
    const currentUserDoc = await getDoc(doc(db, "users", user.uid))
    const currentUserData = currentUserDoc.data()

    // Send notifications to invited friends
    const notificationPromises = serializedFriendIds.map(async (friendId) => {
      try {
        const notificationId = await NotificationService.sendChallengeInvitationNotification(
          friendId,
          {
            id: user.uid,
            username: currentUserData.username || currentUserData.displayName,
            displayName: currentUserData.displayName || currentUserData.username,
            avatar: currentUserData.avatar || DEFAULT_AVATAR,
          },
          {
            id: challengeRef.id,
            title: challengeData.title,
            type: challengeData.type,
          },
        )

        if (notificationId) {
          console.log(`✅ Challenge invitation notification sent to ${friendId}: ${notificationId}`)
        } else {
          console.warn(`⚠️ Failed to send challenge invitation notification to ${friendId}`)
        }
      } catch (notificationError) {
        console.error(`❌ Error sending challenge invitation notification to ${friendId}:`, notificationError)
      }
    })

    await Promise.allSettled(notificationPromises)

    return {
      success: true,
      message: `Challenge created and ${serializedFriendIds.length} friends invited!`,
      challenge: {
        id: challengeRef.id,
        ...newChallengeData,
        endDate: challengeData.endDate,
      },
    }
  } catch (err) {
    console.error("Error creating challenge:", err)
    throw new Error(err.message || "Failed to create challenge. Please try again.")
  }
}

export const createCustomChallenge = async (customChallenge, targetFriend) => {
  try {
    if (!targetFriend) {
      throw new Error("No target friend selected for challenge.")
    }

    if (!customChallenge.title.trim()) {
      throw new Error("Please enter a challenge title.")
    }

    const user = auth.currentUser

    // Get activity configuration
    const activityConfig = ACTIVITY_TYPES.find((a) => a.id === customChallenge.activityType)
    const difficultyConfig = DIFFICULTY_LEVELS.find((d) => d.id === customChallenge.difficulty)

    // Calculate adjusted goal based on difficulty
    const adjustedGoal = Math.round(customChallenge.goal * difficultyConfig.multiplier)

    const challengeData = {
      title: customChallenge.title,
      description: customChallenge.description,
      type: activityConfig.name,
      activityType: customChallenge.activityType,
      goal: adjustedGoal,
      originalGoal: customChallenge.goal,
      unit: activityConfig.unit,
      difficulty: customChallenge.difficulty,
      difficultyMultiplier: difficultyConfig.multiplier,
      duration: customChallenge.duration,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      endDate: Timestamp.fromDate(new Date(Date.now() + customChallenge.duration * 24 * 60 * 60 * 1000)),
      isPublic: false, // Custom challenges are private
      isCustomChallenge: true,
      participants: [user.uid],
      invitedUsers: [targetFriend.id],
      targetFriend: {
        id: targetFriend.id,
        name: targetFriend.displayName || targetFriend.username,
        avatar: targetFriend.avatar,
      },
      status: "pending",
    }

    console.log("🏆 Creating custom challenge:", challengeData)

    const challengeRef = await addDoc(collection(db, "challenges"), challengeData)

    // Get current user data for notification
    const currentUserDoc = await getDoc(doc(db, "users", user.uid))
    const currentUserData = currentUserDoc.data()

    // Send notification to the target friend
    try {
      const notificationId = await NotificationService.sendChallengeInvitationNotification(
        targetFriend.id,
        {
          id: user.uid,
          username: currentUserData.username || currentUserData.displayName,
          displayName: currentUserData.displayName || currentUserData.username,
          avatar: currentUserData.avatar || DEFAULT_AVATAR,
        },
        {
          id: challengeRef.id,
          title: customChallenge.title,
          type: activityConfig.name,
          goal: adjustedGoal,
          unit: activityConfig.unit,
          difficulty: difficultyConfig.name,
          duration: customChallenge.duration,
        },
      )

      if (notificationId) {
        console.log(`✅ Custom challenge notification sent: ${notificationId}`)
      } else {
        console.warn("⚠️ Failed to send custom challenge notification")
      }
    } catch (notificationError) {
      console.error("❌ Error sending custom challenge notification:", notificationError)
    }

    return {
      success: true,
      message: `Your ${activityConfig.name.toLowerCase()} challenge has been sent to ${targetFriend.displayName || targetFriend.username}!`,
      challenge: {
        id: challengeRef.id,
        ...challengeData,
        endDate: new Date(Date.now() + customChallenge.duration * 24 * 60 * 60 * 1000),
      },
    }
  } catch (err) {
    console.error("Error creating custom challenge:", err)
    throw new Error(err.message || "Failed to create challenge. Please try again.")
  }
}

export const joinChallenge = async (challengeId) => {
  try {
    const user = auth.currentUser
    const challengeRef = doc(db, "challenges", challengeId)
    const challengeDoc = await getDoc(challengeRef)

    if (!challengeDoc.exists()) {
      throw new Error("Challenge not found")
    }

    const challengeData = challengeDoc.data()
    const participants = challengeData.participants || []

    if (participants.includes(user.uid)) {
      throw new Error("You are already participating in this challenge")
    }

    await updateDoc(challengeRef, {
      participants: arrayUnion(user.uid),
      status: challengeData.isCustomChallenge ? "active" : challengeData.status,
    })

    const cachedChallenges = (await getCachedData("challenges")) || []
    const updatedCachedChallenges = cachedChallenges.map((challenge) =>
      challenge.id === challengeId
        ? { ...challenge, participants: [...(challenge.participants || []), user.uid] }
        : challenge,
    )
    await setCachedData("challenges", updatedCachedChallenges)

    return {
      success: true,
      message: "You've joined the challenge!",
      updatedParticipants: [...participants, user.uid],
    }
  } catch (err) {
    console.error("Error joining challenge:", err)
    throw new Error(err.message || "Failed to join challenge. Please try again.")
  }
}

// Leaderboard Management
export const loadLeaderboardData = async (callbacks) => {
  const { setLeaderboard, setError } = callbacks

  try {
    const cachedLeaderboard = await getCachedData("leaderboard")
    if (cachedLeaderboard) {
      setLeaderboard(cachedLeaderboard)
    }

    const user = auth.currentUser
    if (!user) return

    const userDistances = {}
    const userNames = {}
    const userAvatars = {}
    const userDocs = {}

    const activitiesRef = collection(db, "activities")
    const activitiesQuery = query(activitiesRef, limit(50))
    const activitiesSnapshot = await getDocs(activitiesQuery)

    for (const activityDoc of activitiesSnapshot.docs) {
      const activityData = activityDoc.data()
      const userId = activityData.userId
      if (!userId) continue

      if (!userDistances[userId]) {
        userDistances[userId] = 0
      }

      const distance =
        typeof activityData.distance === "number" && !isNaN(activityData.distance) ? activityData.distance : 0
      userDistances[userId] += distance
    }

    const userIds = Object.keys(userDistances)
    if (userIds.length > 0) {
      const chunks = []
      for (let i = 0; i < userIds.length; i += 10) {
        chunks.push(userIds.slice(i, i + 10))
      }

      for (const chunk of chunks) {
        const usersQuery = query(collection(db, "users"), where(documentId(), "in", chunk))
        const usersSnapshot = await getDocs(usersQuery)

        for (const userDoc of usersSnapshot.docs) {
          const userData = userDoc.data()
          userNames[userDoc.id] = userData.displayName || userData.username || "User"
          userAvatars[userDoc.id] = userData.avatar || DEFAULT_AVATAR
          userDocs[userDoc.id] = userData
        }
      }
    }

    const leaderboardData = userIds.map((userId) => ({
      id: userId,
      name: userNames[userId] || "User",
      avatar: userAvatars[userId] || DEFAULT_AVATAR,
      distance: userDistances[userId] || 0,
      isCurrentUser: userId === user.uid,
      isOnline: userDocs[userId]?.isOnline || false,
    }))

    leaderboardData.sort((a, b) => b.distance - a.distance)
    const topLeaderboard = leaderboardData.slice(0, 10)

    setLeaderboard(topLeaderboard)
    await setCachedData("leaderboard", topLeaderboard)
  } catch (err) {
    console.warn("Error creating leaderboard:", err)
    setError(`Error loading leaderboard: ${err.message}`)
  }
}

// Chat Management
export const setupChatRoom = async (friendId) => {
  try {
    const user = auth.currentUser
    if (!user) {
      throw new Error("User not authenticated")
    }

    const chatRoomId = [user.uid, friendId].sort().join("_")

    const cachedMessages = await getCachedData(`chatMessages_${chatRoomId}`)
    let initialMessages = []
    if (cachedMessages) {
      initialMessages = cachedMessages
    }

    const chatRoomRef = doc(db, `chatRooms/${chatRoomId}`)
    const chatRoomDoc = await getDoc(chatRoomRef)

    if (!chatRoomDoc.exists()) {
      try {
        await setDoc(chatRoomRef, {
          participants: [user.uid, friendId],
          createdAt: serverTimestamp(),
          lastMessage: null,
          lastMessageTime: null,
        })
        await new Promise((resolve) => setTimeout(resolve, 500))
        console.log("Chat room created successfully")
      } catch (createErr) {
        console.error("Error creating chat room:", createErr)
        throw new Error("Failed to create chat room: " + createErr.message)
      }
    }

    try {
      const messagesRef = collection(db, `chatRooms/${chatRoomId}/messages`)
      const messagesQuery = query(messagesRef, orderBy("timestamp", "desc"), limit(20))
      const messagesSnapshot = await getDocs(messagesQuery)

      const messages = messagesSnapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...doc.data(),
          timestamp: doc.data().timestamp?.toDate() || new Date(),
        }))
        .reverse()

      await setCachedData(`chatMessages_${chatRoomId}`, messages)

      return {
        success: true,
        chatRoomId,
        messages,
        initialMessages,
      }
    } catch (messagesErr) {
      console.error("Error fetching chat messages:", messagesErr)
      throw new Error("Failed to load messages: " + messagesErr.message)
    }
  } catch (err) {
    console.error("Error setting up chat room:", err)
    let errorMessage = "Failed to open chat. Please try again."

    if (err.code === "permission-denied") {
      errorMessage = "You don't have permission to access this chat. This may be due to security rules."
    }

    throw new Error(errorMessage)
  }
}

export const sendChatMessage = async (chatRoomId, messageText, selectedFriend, userProfile) => {
  try {
    if (!messageText.trim() || !selectedFriend) {
      throw new Error("Message text and friend are required")
    }

    const user = auth.currentUser

    // Send message to Firestore
    const batch = writeBatch(db)
    const messagesRef = collection(db, `chatRooms/${chatRoomId}/messages`)
    const newMessageRef = doc(messagesRef)

    const newMessage = {
      text: messageText.trim(),
      senderId: user.uid,
      senderName: userProfile?.username || user.displayName || "You",
      timestamp: serverTimestamp(),
    }

    batch.set(newMessageRef, newMessage)

    // Update chat room with last message
    const chatRoomRef = doc(db, "chatRooms", chatRoomId)
    batch.update(chatRoomRef, {
      lastMessage: messageText.trim(),
      lastMessageTime: serverTimestamp(),
    })

    await batch.commit()

    // Send notification to the recipient using the real NotificationService
    try {
      const notificationId = await NotificationService.sendChatMessageNotification(
        selectedFriend.id,
        {
          id: user.uid,
          username: userProfile?.username || userProfile?.displayName,
          displayName: userProfile?.displayName || userProfile?.username || user.displayName,
          avatar: userProfile?.avatar || DEFAULT_AVATAR,
        },
        messageText.trim(),
        chatRoomId,
      )

      if (notificationId) {
        console.log(`✅ Chat message notification sent: ${notificationId}`)
      } else {
        console.warn("⚠️ Failed to send chat message notification")
      }
    } catch (notificationError) {
      console.error("❌ Error sending chat message notification:", notificationError)
      // Don't fail the entire operation if notification fails
    }

    return {
      success: true,
      messageId: newMessageRef.id,
      message: newMessage,
    }
  } catch (err) {
    console.error("Error sending message:", err)
    throw new Error("Failed to send message. Please try again.")
  }
}

// Online Status Management
export const setUserOnlineStatus = async () => {
  try {
    const user = auth.currentUser
    if (!user) return

    const userRef = doc(db, "users", user.uid)
    await updateDoc(userRef, {
      isOnline: true,
      lastSeen: serverTimestamp(),
    })
  } catch (err) {
    console.warn("Error setting online status:", err)
  }
}

export const setUserOfflineStatus = async () => {
  try {
    const user = auth.currentUser
    if (!user) return

    const userRef = doc(db, "users", user.uid)
    await updateDoc(userRef, {
      isOnline: false,
      lastSeen: serverTimestamp(),
    })
  } catch (err) {
    console.warn("Error updating offline status:", err)
  }
}

// Utility Functions
export const formatLastActive = (timestamp) => {
  if (!timestamp) return "Never active"
  const now = new Date()
  const lastActive = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
  const diffMs = now - lastActive
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return "Just now"
  if (diffMins < 60) return `${diffMins} min${diffMins === 1 ? "" : "s"} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`
  return lastActive.toLocaleDateString()
}

export const formatTime = (seconds) => {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes}:${remainingSeconds < 10 ? "0" : ""}${remainingSeconds}`
}

export const formatActivityDescription = (activity) => {
  if (!activity) return "No recent activity"

  const activityType = activity.activityType || "activity"
  const distance =
    typeof activity.distance === "number" && !isNaN(activity.distance) ? `${activity.distance.toFixed(2)} km` : "0 km"
  const timeAgo = activity.createdAt ? formatLastActive(activity.createdAt) : "Unknown time"

  return `${activityType.charAt(0).toUpperCase() + activityType.slice(1)} ${distance} • ${timeAgo}`
}
