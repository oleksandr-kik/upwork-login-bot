require("dotenv").config();
import { StatusCodes } from "http-status-codes";
import { UpworkLoginPage } from "../classes/UpworkPage/UpworkLoginPage/UpworkLoginPage";
import { AUTH_ERROR_CODES, NETWORK_TIMEOUT, ONE_SECOND, UpworkUrlPaths } from "../constants";
import {
  delay,
  getRandomNumberBetweenRange,
  retry,
  simulateHumanClick,
  simulateHumanType,
} from "../helpers";
import PageWrapper from "../classes/PageWrapper";
import logger from "../logger";

export async function handleUsernameAndPassword({
  page,
  username,
  password,
}: {
  page: PageWrapper;
  username: string;
  password: string;
}): Promise<{
  statusCode: number;
  errCode: AUTH_ERROR_CODES | undefined;
  UWLoginPage: UpworkLoginPage;
}> {
  let UWLoginPage!: UpworkLoginPage;

  const { statusCode, errCode } = await retry(
    async (attempt) => {
      await page.goto(UpworkUrlPaths.LOGIN_PAGE, {
        waitUntil: "load",
        timeout: NETWORK_TIMEOUT,
      });

      UWLoginPage = new UpworkLoginPage(page);

      /** Username and password step */
      const { statusCode, errCode } = await usernamePasswordStep({
        UWLoginPage,
        username,
        password,
      });

      // We need to reset the page. Change proxy and restart w/ a different one
      if (
        errCode === AUTH_ERROR_CODES.AUTH_NETWORK_RESTRICTED ||
        errCode === AUTH_ERROR_CODES.AUTH_TECH_DIFFICULTIES
      ) {
        logger.error(`Error code: ${errCode}. Change proxy and try again.`);

        //[... Code omitted here]

        throw new Error(`Authentication failed.`);
      }

      if (statusCode === StatusCodes.UNAUTHORIZED) {
        return { statusCode, errCode };
      }

      // We logged in w/o a 2fa
      if (!page.url().includes(UpworkUrlPaths.LOGIN_PAGE)) {
        return { statusCode, errCode };
      }

      // Wait for either login input or 2fa input or freelancer page to
      // be visible and interactable
      await UWLoginPage.waitForLoginSecondScreen();

      return { statusCode, errCode };
    },
    { maxAttempts: 5, delayBetweenAttempts: ONE_SECOND * 3 }
  );

  return { statusCode, errCode, UWLoginPage };
}

export async function usernamePasswordStep({
  UWLoginPage,
  username,
  password,
}: {
  UWLoginPage: UpworkLoginPage;
  username: string;
  password: string;
}) {
  const loginInput = await UWLoginPage.getLoginInput();

  await delay(getRandomNumberBetweenRange(ONE_SECOND, ONE_SECOND * 3));

  await simulateHumanType({ element: loginInput, inputString: username });

  await delay(getRandomNumberBetweenRange(500, 1000));

  // Continue shows next
  let continueButton = await UWLoginPage.getFirstContinueLoginButton();
  await simulateHumanClick(continueButton);

  // Then password shows
  const loginPassword = await UWLoginPage.getLoginPasswordInput();
  await simulateHumanType({ element: loginPassword, inputString: password });

  await delay(500);

  // Click on remember me. waitForSelector won't find it for some reason
  await UWLoginPage.clickRememberMe();

  await delay(500);

  const loginPromise = UWLoginPage.page
    .waitForResponse(
      (response) => {
        return response.url().includes("https://www.upwork.com/ab/account-security/login"); // Modify this condition based on your needs
      },
      { timeout: NETWORK_TIMEOUT },
      "https://www.upwork.com/ab/account-security/login - call failed - authenticate"
    )
    .then((res) => {
      return res;
    });

  // Click on continue button
  continueButton = await UWLoginPage.getSecondContinueLoginButton();

  await simulateHumanClick(continueButton);

  await delay(ONE_SECOND * 5);

  /** Check if we failed to authenticate. In this case we retry with a
   *  different proxy
   */
  let error = await checkForAuthenticationErrors(UWLoginPage);

  if (error) {
    return { statusCode: StatusCodes.OK, errCode: error };
  }

  const loginResponse = await (await loginPromise).json();
  if (loginResponse?.eventCode === "wrongPassword") {
    return {
      statusCode: StatusCodes.UNAUTHORIZED,
      errCode: AUTH_ERROR_CODES.AUTH_WRONG_CREDENTIALS,
    };
  }

  return { statusCode: StatusCodes.OK, errCode: undefined };
}

async function checkForAuthenticationErrors(UWLoginPage: UpworkLoginPage) {
  if (await UWLoginPage.checkNetworkRestrictionError()) {
    return AUTH_ERROR_CODES.AUTH_NETWORK_RESTRICTED;
  } else if (await UWLoginPage.checkTechnicalIssuesError()) {
    return AUTH_ERROR_CODES.AUTH_TECH_DIFFICULTIES;
  }

  return;
}
