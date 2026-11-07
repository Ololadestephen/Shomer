// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ShomerVerificationRegistry
 * @notice Immutable on-chain registry for Shomer deployment policy verification receipts.
 * @dev Stores cryptographically bound publication receipts:
 *      publisher, inspected chain, target contract, inspected block, policy hash, report hash, verdict.
 *
 * Integrity rules:
 * 1. Records are immutable once published.
 * 2. Record ID strictly binds publisher, chain, contract, block, policy hash, and report hash.
 * 3. Empty hashes and zero addresses are rejected.
 * 4. Duplicate publications by the same publisher with the same fingerprint revert.
 * 5. A publication receipt establishes integrity and timestamp, not security or an audit.
 */
contract ShomerVerificationRegistry {
    enum Verdict {
        Blocked,        // 0: Hard policy violation
        ReviewRequired, // 1: Incomplete evidence or undeclared privilege
        PolicyMatched   // 2: All declared hard rules matched pinned state
    }

    struct VerificationRecord {
        address publisher;
        uint256 inspectedChain;
        address targetContract;
        uint256 inspectedBlock;
        bytes32 policyHash;
        bytes32 reportHash;
        uint8 verdict;
        uint256 publishedAt;
    }

    /// @notice Maps recordId => VerificationRecord
    mapping(bytes32 => VerificationRecord) public records;

    /// @notice All recorded IDs in order of publication
    bytes32[] public recordIds;

    /// @notice Records indexed by publisher
    mapping(address => bytes32[]) private _publisherRecords;

    /// @notice Records indexed by target contract on an inspected chain
    mapping(bytes32 => bytes32[]) private _targetRecords;

    event VerificationPublished(
        bytes32 indexed recordId,
        address indexed publisher,
        address indexed targetContract,
        uint256 inspectedChain,
        uint256 inspectedBlock,
        bytes32 policyHash,
        bytes32 reportHash,
        uint8 verdict,
        uint256 publishedAt
    );

    error InvalidTargetContract();
    error InvalidInspectedChain();
    error InvalidInspectedBlock();
    error EmptyPolicyHash();
    error EmptyReportHash();
    error InvalidVerdict();
    error RecordAlreadyExists(bytes32 recordId);
    error RecordNotFound(bytes32 recordId);

    /**
     * @notice Publishes an immutable verification record.
     * @param inspectedChain EIP-155 chain ID of the inspected contract.
     * @param targetContract Address of the verified contract.
     * @param inspectedBlock Block number at which facts were read.
     * @param policyHash Keccak256 hash of the approved policy manifest.
     * @param reportHash Keccak256 hash of the canonical public report snapshot.
     * @param verdict 0 = Blocked, 1 = ReviewRequired, 2 = PolicyMatched.
     * @return recordId Unique deterministic identifier of the published receipt.
     */
    function publishVerification(
        uint256 inspectedChain,
        address targetContract,
        uint256 inspectedBlock,
        bytes32 policyHash,
        bytes32 reportHash,
        uint8 verdict
    ) external returns (bytes32 recordId) {
        if (targetContract == address(0)) revert InvalidTargetContract();
        if (inspectedChain == 0) revert InvalidInspectedChain();
        if (inspectedBlock == 0) revert InvalidInspectedBlock();
        if (policyHash == bytes32(0)) revert EmptyPolicyHash();
        if (reportHash == bytes32(0)) revert EmptyReportHash();
        if (verdict > 2) revert InvalidVerdict();

        recordId = computeRecordId(
            msg.sender,
            inspectedChain,
            targetContract,
            inspectedBlock,
            policyHash,
            reportHash
        );

        if (records[recordId].publishedAt != 0) {
            revert RecordAlreadyExists(recordId);
        }

        records[recordId] = VerificationRecord({
            publisher: msg.sender,
            inspectedChain: inspectedChain,
            targetContract: targetContract,
            inspectedBlock: inspectedBlock,
            policyHash: policyHash,
            reportHash: reportHash,
            verdict: verdict,
            publishedAt: block.timestamp
        });

        recordIds.push(recordId);
        _publisherRecords[msg.sender].push(recordId);

        bytes32 targetKey = keccak256(abi.encode(inspectedChain, targetContract));
        _targetRecords[targetKey].push(recordId);

        emit VerificationPublished(
            recordId,
            msg.sender,
            targetContract,
            inspectedChain,
            inspectedBlock,
            policyHash,
            reportHash,
            verdict,
            block.timestamp
        );
    }

    /**
     * @notice Computes the canonical record ID for a publication.
     */
    function computeRecordId(
        address publisher,
        uint256 inspectedChain,
        address targetContract,
        uint256 inspectedBlock,
        bytes32 policyHash,
        bytes32 reportHash
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                publisher,
                inspectedChain,
                targetContract,
                inspectedBlock,
                policyHash,
                reportHash
            )
        );
    }

    function getRecord(bytes32 recordId) external view returns (VerificationRecord memory) {
        VerificationRecord memory rec = records[recordId];
        if (rec.publishedAt == 0) revert RecordNotFound(recordId);
        return rec;
    }

    function recordExists(bytes32 recordId) external view returns (bool) {
        return records[recordId].publishedAt != 0;
    }

    function totalRecords() external view returns (uint256) {
        return recordIds.length;
    }

    function getPublisherRecords(address publisher) external view returns (bytes32[] memory) {
        return _publisherRecords[publisher];
    }

    function getTargetRecords(uint256 inspectedChain, address targetContract)
        external
        view
        returns (bytes32[] memory)
    {
        bytes32 targetKey = keccak256(abi.encode(inspectedChain, targetContract));
        return _targetRecords[targetKey];
    }
}
