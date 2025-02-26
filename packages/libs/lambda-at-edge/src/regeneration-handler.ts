import lambdaAtEdgeCompat from "@sls-next/next-aws-cloudfront";
// @ts-ignore
import Manifest from "./manifest.json";
import {
  OriginRequestDefaultHandlerManifest,
  RegenerationEvent
} from "./types";
import setNextjsSiteEnvironment from "./lib/setNextjsSiteEnvironment";
import { s3StorePage } from "./s3/s3StorePage";
import { renderPageToHtml } from "@serverless-stack/nextjs-core";

export const handler = async (event: AWSLambda.SQSEvent): Promise<void> => {
  // SST set NextjsSite environment because Lambda@Edge does not support
  //     environment variables
  setNextjsSiteEnvironment();

  await Promise.all(
    event.Records.map(async (record) => {
      const regenerationEvent: RegenerationEvent = JSON.parse(record.body);

      const manifest: OriginRequestDefaultHandlerManifest = Manifest;
      const { req, res } = lambdaAtEdgeCompat(
        { request: regenerationEvent.cloudFrontEventRequest },
        { enableHTTPCompression: manifest.enableHTTPCompression }
      );

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const page = require(`./${regenerationEvent.pagePath}`);

      const { renderOpts, html } = await renderPageToHtml(
        page,
        req,
        res,
        "passthrough"
      );

      await s3StorePage({
        html,
        uri: regenerationEvent.cloudFrontEventRequest.uri,
        basePath: regenerationEvent.basePath,
        bucketName: regenerationEvent.bucketName,
        buildId: manifest.buildId,
        pageData: renderOpts.pageData,
        region: regenerationEvent.region,
        revalidate: renderOpts.revalidate as number
      });
    })
  );
};
