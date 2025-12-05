import "dotenv/config";
import PageWrapper from "./classes/PageWrapper";
import { getBrowser, setEnvironmentData } from "./config";
import authenticate from "./userSetup/authenticate";
import { NETWORK_TIMEOUT } from "./constants";

setEnvironmentData({
  userName: "",
  proxyUrl: "http://q82qg:wr6ffw0i@43.239.161.5:5432",
});

(async () => {
  const browser = await getBrowser({ headless: false, noUserData: true });
  const page = await new PageWrapper(await browser.newPage());

  await page.goto("https://www.upwork.com/ab/account-security/login");

  const { status } = await authenticate({
    username: "saeleanore.87@outlook.com",
    password: "eXtE31rioR",
    page,
  });

  if (status !== 200) {
    throw new Error(`Login not successful.`);
  }

  await page.goto("https://www.upwork.com/nx/find-work/", { timeout: NETWORK_TIMEOUT });

  console.log(`Login successful.`);
})();
