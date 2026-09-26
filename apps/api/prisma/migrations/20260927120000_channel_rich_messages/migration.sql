-- CreateTable
CREATE TABLE "chatbot_rich_url_policies" (
    "chatbotId" TEXT NOT NULL PRIMARY KEY,
    "hosts" TEXT NOT NULL DEFAULT '[]',
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "chatbot_rich_url_policies_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "chatbots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
