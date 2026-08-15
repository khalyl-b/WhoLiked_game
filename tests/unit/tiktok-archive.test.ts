import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { parseTikTokArchiveBytes, parseTikTokJson, parseTikTokLikeJsonValue } from "@/features/social/tiktok-archive";

describe("TikTok archive parsing", () => {
  it("extracts Like List entries but not watch history or favourites", () => {
    const parsed = parseTikTokJson({
      "Likes and Favourites": {
        "Like List": [
          { Date: "2026-08-01 10:00:00", "Video landing page link": "https://www.tiktok.com/@creator/video/7400000000000000001" },
          { Date: "2026-08-02 11:00:00", "Video landing page link": "https://www.tiktok.com/@creator/video/7400000000000000002" },
        ],
        "Favourite Videos": [
          { Date: "2026-08-03 12:00:00", "Video landing page link": "https://www.tiktok.com/@creator/video/7400000000000000099" },
        ],
      },
      "Your Activity": {
        "Watch History": [
          { Date: "2026-08-04", "Video landing page link": "https://www.tiktok.com/@creator/video/7400000000000000088" },
        ],
      },
    });
    expect(parsed.map((item) => item.videoId)).toEqual(["7400000000000000001", "7400000000000000002"]);
  });

  it("parses a standalone Like List JSON file", () => {
    const parsed = parseTikTokLikeJsonValue([
      { Date: "2026-08-01", Link: "https://www.tiktok.com/@creator/video/7400000000000000003" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].videoId).toBe("7400000000000000003");
  });

  it("deduplicates repeated video IDs inside a zip", async () => {
    const zip = new JSZip();
    zip.file("Likes and Favourites/Like List.json", JSON.stringify([
      { Date: "2026-08-01", "Video Link": "https://www.tiktok.com/@creator/video/7400000000000000004" },
      { Date: "2026-08-02", "Video Link": "https://www.tiktok.com/@creator/video/7400000000000000004?lang=en" },
    ]));
    zip.file("Activity/Watch History.json", JSON.stringify([
      { Date: "2026-08-03", "Video Link": "https://www.tiktok.com/@creator/video/7400000000000000055" },
    ]));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const parsed = await parseTikTokArchiveBytes(bytes);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].videoId).toBe("7400000000000000004");
  });

  it("rejects non-TikTok links", () => {
    const parsed = parseTikTokLikeJsonValue([{ Link: "https://example.com/video/7400000000000000005" }]);
    expect(parsed).toEqual([]);
  });


  it("does not treat Favourite Videos as likes when the ZIP file itself is named Likes and Favourites", async () => {
    const zip = new JSZip();
    zip.file("TikTok/Activity/Likes and Favourites.json", JSON.stringify({
      "Likes and Favourites": {
        "Like List": [
          { Date: "2026-08-01 10:00:00", "Video landing page link": "https://www.tiktok.com/@liked/video/7234567890123456789" },
        ],
        "Favourite Videos": [
          { Date: "2026-08-02 10:00:00", "Video landing page link": "https://www.tiktok.com/@saved/video/8234567890123456789" },
        ],
      },
      "Your Activity": {
        "Watch History": [
          { Date: "2026-08-03 10:00:00", "Video landing page link": "https://www.tiktok.com/@watched/video/9234567890123456789" },
        ],
      },
    }));
    const archive = await zip.generateAsync({ type: "uint8array" });
    const likes = await parseTikTokArchiveBytes(archive);
    expect(likes.map((item) => item.videoId)).toEqual(["7234567890123456789"]);
  });
});
