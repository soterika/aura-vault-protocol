// CloudFront cache invalidation Lambda (Node.js 20.x)
const {
  CloudFrontClient,
  CreateInvalidationCommand,
} = require("@aws-sdk/client-cloudfront");

const cf = new CloudFrontClient({});

exports.handler = async (event) => {
  const distributionId = process.env.DISTRIBUTION_ID;
  if (!distributionId) throw new Error("DISTRIBUTION_ID not set");

  // Derive paths from S3 event keys; fall back to wildcard
  const paths =
    event.Records?.map((r) => "/" + decodeURIComponent(r.s3.object.key)) ?? [
      "/*",
    ];

  await cf.send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: String(Date.now()),
        Paths: { Quantity: paths.length, Items: paths },
      },
    })
  );

  console.log("Invalidated", paths);
};
