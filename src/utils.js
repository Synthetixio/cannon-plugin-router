const { ethers } = require("ethers");

exports.getContractDefinitionFromPath = function getContractDefinitionFromPath(
  ctx,
  path
) {
  const pathPieces = path.split(".");

  let importsBase = ctx;
  for (const p of pathPieces.slice(0, -1)) {
    importsBase = importsBase.imports[p];
  }

  const c = importsBase?.contracts?.[pathPieces[pathPieces.length - 1]];

  return c || null;
};

exports.getMergedAbiFromContractPaths = function getMergedAbiFromContractPaths(
  ctx,
  paths
) {
  return paths
    .flatMap((contractPath) => {
      const c = getContractDefinitionFromPath(ctx, contractPath);

      if (!c) {
        throw new Error(
          `previously deployed contract with identifier "${contractPath}" for factory not found`
        );
      }

      if (!Array.isArray(c.abi)) {
        throw new Error(
          `Contract definition for "${contractPath}" does not have a valid abi`
        );
      }

      return c.abi;
    })
    .filter((a, index, abi) => {
      if (index === 0) return true;
      const alreadyExists = abi.slice(0, index).some((b) => {
        //console.log(ethers.utils.Fragment.from(b).format('minimal'), ethers.utils.Fragment.from(a).format('minimal'));
        return (
          ethers.utils.Fragment.from(b).format("minimal") ===
          ethers.utils.Fragment.from(a).format("minimal")
        );
      });

      return !alreadyExists;
    });
};
