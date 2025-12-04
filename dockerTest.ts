import "dotenv/config";
import PageWrapper from "./src/classes/PageWrapper";
import { getBrowser } from "./src/config";
import { delay } from "./src/helpers";
import { ONE_MINUTE } from "./src/constants";

const VIEWPORT = { width: 900, height: 700 };

(async () => {
  // Launch the browser and open a new blank page
  const browser = await getBrowser({ headless: false, noProxy: true });
  const pageWrapper = new PageWrapper(await browser.newPage());

  console.log("Environment is ", process.env.NODE_ENV as string);

  // Navigate to Google's homepage
  await pageWrapper.goto("https://www.google.com");

  // Take a screenshot to verify headful mode is working
  await pageWrapper.getPage().screenshot({ path: "google_headful_test.png" });

  console.log("Screenshot taken successfully. Check the file google_headful_test.png.");

  // Close the browser once done
  await delay(ONE_MINUTE);

  await browser.close();
})();
