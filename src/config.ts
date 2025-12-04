require("dotenv").config();
import path from "path";
import { Browser } from "puppeteer";
import puppeteer, { VanillaPuppeteer } from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth"; // from local workspace package
import treeKill from "tree-kill";
import logger from "./logger";
import {
  closeProxyServer,
  createProxyServer,
  LOCAL_PROXY_SERVER_PORT,
  resolveTimezone,
} from "./proxy";
import { NETWORK_TIMEOUT } from "./constants";

const BASE_WINDOW_WIDTH = 880;
const BASE_WINDOW_HEIGHT = 950;

puppeteer.use(
  require("puppeteer-extra-plugin-user-preferences")({
    userPrefs: {
      safebrowsing: {
        enabled: false,
        enhanced: false,
      },
    },
  })
);

const stealth = StealthPlugin();

// Trying to find memory leak culprits
stealth.enabledEvasions.delete("navigator.languages"); // Calls many experimental methods in workers

puppeteer.use(stealth);

let browser: Browser | null;

/** USER_ID will be available in the k8s cluster */
let userAuthId: string | null = process.env.USER_ID ?? null;

let environmentData: { userName: string; proxyUrl: string } | null = null;

let newProxyUrl = "";

const args_ = process.argv.slice(2);
const flags: { [key: string]: any } = {};

args_.forEach((arg) => {
  flags[arg] = true;
});

export const isRunningWithoutProxy = flags["--runWithoutProxy"];

type Options = {
  noUserData?: boolean;
  noProxy?: boolean;
  headless?: boolean;
  args?: string[];
};

export const getUserAuthId = () => {
  if (!userAuthId) {
    throw new Error("Bot running but userAuthId is not defined!");
  }

  return userAuthId;
};

export const getEnvironmentData = () => {
  return environmentData;
};

export const setUserAuthId = (userId: string) => {
  userAuthId = userId;
};

export const setEnvironmentData = ({
  userName,
  proxyUrl,
}: {
  userName: string;
  proxyUrl: string;
}) => {
  environmentData = { userName, proxyUrl };
};

export const hasBrowserLaunched = (): boolean => browser !== null && browser !== undefined;

export const getBrowser = async ({
  noUserData = false,
  noProxy = false,
  headless = false,
  args = [] as string[],
}: Options = {}) => {
  if (browser) {
    return browser;
  }

  // Use different dimensions to slightly alter fingerprint
  const randomizedWidth = BASE_WINDOW_WIDTH + Math.floor(Math.random() * 101) - 50;
  const randomizedHeight = BASE_WINDOW_HEIGHT + Math.floor(Math.random() * 101) - 50;

  const isTestEnvironment = process.env.NODE_ENV === "test";
  const isDevEnvironment = process.env.NODE_ENV === "dev";

  const launchParams: Parameters<VanillaPuppeteer["launch"]>[0] = {
    headless,
    ...(!!!noUserData &&
      !isTestEnvironment && {
        userDataDir: `${path.join(__dirname, "./sessions/userData")}`,
      }),
    protocolTimeout: NETWORK_TIMEOUT,
    args: [
      `--no-first-run`,
      `--ash-no-nudges`,
      `--no-default-browser-check`,
      `--window-size=${randomizedWidth},${randomizedHeight}`,
      "--webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--force-webrtc-ip-handling-policy",
      "--disable-blink-features=AutomationControlled",
      "--start-maximized",
      "--disable-infobars",
      ...args,
    ],
    browser: "chrome",
    ignoreDefaultArgs: ["--enable-automation", "--enable-features=PdfOopif"],
    env: {
      DISPLAY: process.env.DISPLAY,
      XAUTHORITY: process.env.XAUTHORITY,
      FONTCONFIG_PATH: process.env.FONTCONFIG_PATH,
      FONTCONFIG_CACHE: process.env.FONTCONFIG_CACHE,
      ...process.env,
    },
  };

  // DISPLAY will be available in docker
  launchParams.executablePath = process.env.DISPLAY
    ? "/usr/bin/google-chrome"
    : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

  // Use this to set the puppeteer timezone
  let timezone = "";

  if ((isDevEnvironment && isRunningWithoutProxy) || (noProxy && isDevEnvironment)) {
    logger.info("Running without proxy");

    timezone = await resolveTimezone({ noProxy: true });
  }
  // Prod and proxy dev run
  else {
    if (!environmentData?.proxyUrl) {
      throw new Error("NO PROXY FOUND!");
    }

    await createProxyServer();

    /** We create a local proxy and attach it to puppeteer. This will make
     *  it so that we can dynamically change the browser's ip without having
     *  to close and reopen the browser.
     */
    newProxyUrl = `http://localhost:${LOCAL_PROXY_SERVER_PORT}`;

    launchParams.args!.push(`--proxy-server=${newProxyUrl}`);

    const proxyUrl = new URL(environmentData.proxyUrl);

    /** Get the timezone of this proxy */
    timezone = await resolveTimezone({ proxyUrl });
  }

  /** Set the correct timezone in the environment */
  launchParams.env!.TZ = timezone;

  logger.info(`Timezone set to ${timezone}.`);

  browser = await puppeteer.launch(launchParams);

  return browser;
};

export const killBrowser = async () => {
  try {
    if (!browser) return;

    if (newProxyUrl) {
      await closeProxyServer();
    }

    treeKill(browser.process()?.pid!, "SIGKILL");
    logger.info("Browser successfully killed ✅");
    browser = null;
  } catch (error) {
    logger.error("Error while killing browser", error);
    browser = null;
  }
};
