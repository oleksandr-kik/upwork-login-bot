import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import * as ProxyChain from "proxy-chain";
import { getEnvironmentData, isRunningWithoutProxy } from "./config";
import { ONE_SECOND } from "./constants";
import { retry } from "./helpers";
import logger from "./logger";

let proxyServer: ProxyChain.Server | undefined;

export type ProxyInfo = {
  isValid: boolean;
  geo: {
    city: string;
    country: string;
    countryCode: string;
    regionName: string;
    timezone: string;
    isp?: string;
    org?: string;
    ip: string;
  };
};

export const LOCAL_PROXY_SERVER_PORT = 8001;

export const createProxyServer = () => {
  if (proxyServer) {
    closeProxyServer();
  }

  logger.info("Connected via proxy ✅");

  proxyServer = new ProxyChain.Server({
    port: LOCAL_PROXY_SERVER_PORT,
    prepareRequestFunction: () => {
      let upstreamProxy = getEnvironmentData()?.proxyUrl;
      if (!upstreamProxy && !isRunningWithoutProxy) {
        throw Error("Proxy not detected!");
      }

      return {
        upstreamProxyUrl: upstreamProxy,
      };
    },
  });

  proxyServer.listen(() => {
    logger.info(`Proxy server is listening on port ${proxyServer?.port}`);
  });
};

export const closeProxyServer = () => {
  if (proxyServer) {
    proxyServer.close(true);
    proxyServer = undefined;
  }
};

/** Util function to retrieve the timezone from the proxy or current IP */
export async function resolveTimezone({
  noProxy,
  proxyUrl,
  noRetries,
}: { noProxy?: boolean; proxyUrl?: URL; noRetries?: boolean } = {}) {
  if (!proxyUrl && !noProxy) {
    throw new Error("Running with proxy but no proxy provided!");
  }

  const getIpInfo = async () => {
    if (proxyUrl && !noProxy) {
      const proxyInfo = await getProxyInformationHelper(proxyUrl.toString());

      if (!proxyInfo.isValid) {
        throw new Error("Invalid proxy");
      }
      return proxyInfo;
    }

    const data = await axios.get(`http://ip-api.com/json/?fields=timezone`);

    return {
      isValid: true,
      geo: {
        timezone: data.data.timezone,
      },
    } as ProxyInfo;
  };

  const ipInfoResponse = noRetries
    ? await getIpInfo()
    : await retry(getIpInfo, {
        maxAttempts: 3,
        delayBetweenAttempts: ONE_SECOND * 2,
      });

  if (!ipInfoResponse?.geo?.timezone) {
    throw new Error("Timezone not returned for proxy!");
  }

  return ipInfoResponse.geo.timezone;
}

export async function getProxyInformationHelper(proxyUrl: string) {
  let isValid = false;
  let geo: any = {};

  try {
    // Parse full proxy URL
    const parsed = new URL(proxyUrl);
    const { hostname, port, username, password } = parsed;

    // Decide which service to call
    const ipLiteral = /^\d+\.\d+\.\d+\.\d+$/;
    const agent = new HttpsProxyAgent(proxyUrl);

    // request-promise will parse that proxy URL and tunnel for us
    const resp = ipLiteral.test(hostname)
      ? await axios.get(`http://ip-api.com/json/${hostname}`, {
          proxy: { host: hostname, port: parseInt(port, 10), auth: { username, password } },
          timeout: 10000,
        })
      : await axios.get("http://ip-api.com/json", {
          httpAgent: agent,
          httpsAgent: agent,
          timeout: 10000,
          responseType: "json",
        });

    isValid = true;

    const { city, country, countryCode, regionName, timezone, isp, org, query } = resp.data;
    geo = {
      city,
      country,
      countryCode,
      regionName,
      timezone,
      isp,
      org,
      ip: query,
    };
  } catch (error: any) {
    logger.error("Proxy validation failed", error);
    isValid = false;
    geo = {};
  }

  return {
    isValid,
    geo,
  };
}
