import express from "express";
import CancellationFeedbackSchema from "../schemas/cancellation-feedback-schema";

export const submitCancellationFeedback = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const { rating, comments } = req.body;

    if (rating !== undefined && (typeof rating !== "number" || rating < 1 || rating > 5)) {
      return res.status(400).json({ error: "Rating must be a number between 1 and 5" });
    }

    // Find the most recent cancellation feedback for this patient
    const feedback = await CancellationFeedbackSchema.findOne(
      { patientId: userId },
      {},
      { sort: { createdAt: -1 } }
    );

    if (!feedback) {
      return res.status(404).json({ error: "No cancellation feedback found" });
    }

    if (rating !== undefined) {
      feedback.rating = rating;
    }
    if (comments !== undefined) {
      feedback.comments = comments;
    }

    await feedback.save();

    res.json({ message: "Feedback submitted successfully" });
  } catch (error: any) {
    console.error("Error submitting cancellation feedback:", error);
    res.status(500).json({ error: error.message });
  }
};
