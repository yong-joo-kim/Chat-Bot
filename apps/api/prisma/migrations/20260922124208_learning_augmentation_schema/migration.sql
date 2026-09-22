-- CreateTable
CREATE TABLE "augmentation_suggestions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "textNormalized" TEXT NOT NULL,
    "similarityToSeed" REAL NOT NULL,
    "conflictIntentId" TEXT,
    "conflictScore" REAL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "jobId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "augmentation_suggestions_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "intent_classifier_models" (
    "chatbotId" TEXT NOT NULL PRIMARY KEY,
    "modelId" TEXT NOT NULL,
    "dimension" INTEGER NOT NULL,
    "classIds" TEXT NOT NULL,
    "weights" TEXT NOT NULL,
    "bias" TEXT NOT NULL,
    "classCount" INTEGER NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "accuracy" REAL,
    "trainedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "intentCountAtTrain" INTEGER NOT NULL,
    "exampleCountAtTrain" INTEGER NOT NULL,
    CONSTRAINT "intent_classifier_models_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "training_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatbotId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "resultSummary" TEXT,
    "failureReason" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "training_jobs_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "augmentation_suggestions_chatbotId_intentId_status_createdAt_idx" ON "augmentation_suggestions"("chatbotId", "intentId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "augmentation_suggestions_chatbotId_status_idx" ON "augmentation_suggestions"("chatbotId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "augmentation_suggestions_intentId_textNormalized_key" ON "augmentation_suggestions"("intentId", "textNormalized");

-- CreateIndex
CREATE INDEX "training_jobs_chatbotId_kind_status_idx" ON "training_jobs"("chatbotId", "kind", "status");

-- CreateIndex
CREATE INDEX "training_jobs_chatbotId_createdAt_idx" ON "training_jobs"("chatbotId", "createdAt");
