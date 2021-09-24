// @ts-ignore
import manifest from "./manifest.json";
// @ts-ignore
import RoutesManifestJson from "./routes-manifest.json";
import {
  ImagesManifest,
  OriginRequestEvent,
  OriginRequestImageHandlerManifest,
  RoutesManifest
} from "./types";
import { CloudFrontResultResponse } from "aws-lambda";
import { setCustomHeaders } from "@serverless-stack/nextjs-core";
import lambdaAtEdgeCompat from "@sls-next/next-aws-cloudfront";
import {
  handleAuth,
  handleDomainRedirects
} from "@serverless-stack/nextjs-core";
import { UrlWithParsedQuery } from "url";
import url from "url";
import { imageOptimizer } from "./images/imageOptimizer";
import { removeBlacklistedHeaders } from "./headers/removeBlacklistedHeaders";
import { s3BucketNameFromEventRequest } from "./s3/s3BucketNameFromEventRequest";
import setNextjsSiteEnvironment from "./lib/setNextjsSiteEnvironment";

const basePath = RoutesManifestJson.basePath;

const normaliseUri = (uri: string): string => {
  if (uri.startsWith(basePath)) {
    uri = uri.slice(basePath.length);
  }

  return uri;
};

const isImageOptimizerRequest = (uri: string): boolean =>
  uri.startsWith("/_next/image");

export const handler = async (
  event: OriginRequestEvent
): Promise<CloudFrontResultResponse> => {
  // SST set NextjsSite environment because Lambda@Edge does not support
  //     environment variables
  setNextjsSiteEnvironment();

  const request = event.Records[0].cf.request;
  const routesManifest: RoutesManifest = RoutesManifestJson;
  const buildManifest: OriginRequestImageHandlerManifest = manifest;

  // Handle basic auth
  const authRoute = handleAuth(request, buildManifest);
  if (authRoute) {
    const { isUnauthorized, status, ...response } = authRoute;
    return { ...response, status: status.toString() };
  }

  // Handle domain redirects e.g www to non-www domain
  const redirectRoute = handleDomainRedirects(request, manifest);
  if (redirectRoute) {
    const { isRedirect, status, ...response } = redirectRoute;
    return { ...response, status: status.toString() };
  }

  // No other redirects or rewrites supported for now as it's assumed one is accessing this directly.
  // But it can be added later.

  const uri = normaliseUri(request.uri);

  // Handle image optimizer requests
  const isImageRequest = isImageOptimizerRequest(uri);
  if (isImageRequest) {
    let imagesManifest: ImagesManifest | undefined;

    try {
      // @ts-ignore
      imagesManifest = await import("./images-manifest.json");
    } catch (error) {
      console.warn(
        "Images manifest not found for image optimizer request. Image optimizer will fallback to defaults."
      );
    }

    const { req, res, responsePromise } = lambdaAtEdgeCompat(
      event.Records[0].cf,
      {
        enableHTTPCompression: manifest.enableHTTPCompression
      }
    );

    const urlWithParsedQuery: UrlWithParsedQuery = url.parse(
      `${request.uri}?${request.querystring}`,
      true
    );

    const { region } = request.origin!.s3!;
    const bucketName = s3BucketNameFromEventRequest(request);

    setCustomHeaders({ res, req, responsePromise }, routesManifest);

    await imageOptimizer(
      // SST: NextjsSite construct performs atomic deployment, and the site
      // is deployed to a folder prefixed with the buildId.
      {
        basePath: `${basePath}/deploy-${manifest.buildId}`,
        bucketName: bucketName || "",
        region: region
      },
      imagesManifest,
      req,
      res,
      urlWithParsedQuery
    );

    const response = await responsePromise;

    if (response.headers) {
      removeBlacklistedHeaders(response.headers);
    }

    return response;
  } else {
    return {
      status: "404"
    };
  }
};
