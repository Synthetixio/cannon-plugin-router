const { getContractDefinitionFromPath, getMergedAbiFromContractPaths } = require("./src/utils");
const Debug = require("debug");
const { ContractFactory } = require("ethers");
const _ = require("lodash");
const z = require("zod");

const debug = Debug("router:cannon");

const config = z.object({
	contracts: z.array(z.string()),
	from: z.string().optional(),
	salt: z.string().optional(),
	depends: z.array(z.string()).optional(),
});

// ensure the specified contract is already deployed
// if not deployed, deploy the specified hardhat contract with specfied options, export
// address, abi, etc.
// if already deployed, reexport deployment options for usage downstream and exit with no changes
module.exports = {
	label: "router",

	validate: config,

	async getState(runtime, ctx, config) {
		const newConfig = this.configInject(ctx, config);

		const contractAbis = {};
		const contractAddresses = {};

		for (const n of newConfig.contracts) {
			const contract = getContractDefinitionFromPath(ctx, n);
			if (!contract) {
				throw new Error(`contract not found: ${n}`);
			}

			contractAbis[n] = contract.abi;
			contractAddresses[n] = contract.address;
		}

		return {
			contractAbis,
			contractAddresses,
			config: newConfig,
		};
	},

	configInject(ctx, config) {
		config = _.cloneDeep(config);

		config.contracts = _.map(config.contracts, (n) => _.template(n)(ctx));

		if (config.from) {
			config.from = _.template(config.from)(ctx);
		}

		if (config.salt) {
			config.salt = _.template(config.salt)(ctx);
		}

		return config;
	},

	getInputs(config) {
		return config.contracts.map((c) =>
			c.includes(".") ? `imports.${c.split(".")[0]}` : `contracts.${c}`,
		);
	},

	getOutputs(_, packageState) {
		return [`contracts.${packageState.currentLabel.split(".")[1]}`];
	},

	async exec(runtime, ctx, config, packageState) {
		const { generateRouter } = require("@synthetixio/router/dist/generate");
		const { compileContract, getCompileInput } = require("@synthetixio/router/dist/compile");

		debug("exec", config);

		const contracts = config.contracts.map((n) => {
			const contract = getContractDefinitionFromPath(ctx, n);
			if (!contract) {
				throw new Error(`contract not found: ${n}`);
			}

			return {
				constructorArgs: contract.constructorArgs,
				abi: contract.abi,
				deployedAddress: contract.address,
				deployTxnHash: contract.deployTxnHash,
				contractName: contract.contractName,
				sourceName: contract.sourceName,
				contractFullyQualifiedName: `${contract.sourceName}:${contract.contractName}`,
			};
		});

		const contractName = packageState.currentLabel.slice("router.".length);

		const sourceCode = generateRouter({
			contractName,
			contracts,
		});

		debug("router source code", sourceCode);

		const inputData = await getCompileInput(contractName, sourceCode);
		const solidityInfo = await compileContract(contractName, sourceCode);

		// the abi is entirely basedon the fallback call so we have to generate ABI here
		const routableAbi = getMergedAbiFromContractPaths(ctx, config.contracts);

		runtime.reportContractArtifact(`${contractName}.sol:${contractName}`, {
			contractName,
			sourceName: `${contractName}.sol`,
			abi: routableAbi,
			bytecode: solidityInfo.bytecode,
			deployedBytecode: solidityInfo.deployedBytecode,
			linkReferences: {},
			source: {
				solcVersion: require("solc")
					.version()
					.match(/(^.*commit\.[0-9a-f]*)\..*/)[1],
				input: JSON.stringify(inputData),
			},
		});

		const deployTxn = await ContractFactory.fromSolidity(solidityInfo).getDeployTransaction();

		const signer = config.from
			? await runtime.getSigner(config.from)
			: await runtime.getDefaultSigner(deployTxn, config.salt);

		debug("using deploy signer with address", await signer.getAddress());

		const deployedRouterContractTxn = await signer.sendTransaction(deployTxn);

		const receipt = await deployedRouterContractTxn.wait();

		return {
			contracts: {
				[contractName]: {
					address: receipt.contractAddress,
					abi: routableAbi,
					deployedOn: packageState.currentLabel,
					deployTxnHash: deployedRouterContractTxn.hash,
					contractName,
					sourceName: contractName + ".sol",
					//sourceCode
				},
			},
		};
	},
};
