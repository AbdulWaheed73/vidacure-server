export type SuggestionSubmitterRole = "patient" | "doctor";

export type Suggestion = {
  _id: string;
  submittedBy: string;
  submitterRole: SuggestionSubmitterRole;
  submitterName: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateSuggestionPayload = {
  title: string;
  description: string;
};
