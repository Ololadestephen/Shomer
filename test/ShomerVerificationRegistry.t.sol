// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ShomerVerificationRegistry } from "../contracts/ShomerVerificationRegistry.sol";

// Minimal test harness without external forge-std dependency
contract ShomerVerificationRegistryTest {
    ShomerVerificationRegistry internal registry;

    address internal constant ALICE = address(0x1111111111111111111111111111111111111111);
    address internal constant BOB = address(0x2222222222222222222222222222222222222222);
    address internal constant TARGET = address(0x3C250cBf439431D7dd8525Ca9800c577a9533e3C);

    bytes32 internal constant POLICY_HASH = keccak256("policy-v1-approved");
    bytes32 internal constant REPORT_HASH = keccak256("report-v1-snapshot");
    uint256 internal constant CHAIN_ID = 677; // BOT Chain mainnet
    uint256 internal constant BLOCK_NUM = 19263053;

    function setUp() public {
        registry = new ShomerVerificationRegistry();
    }

    function testPublishAndRecordBinding() public {
        bytes32 expectedId = registry.computeRecordId(
            address(this),
            CHAIN_ID,
            TARGET,
            BLOCK_NUM,
            POLICY_HASH,
            REPORT_HASH
        );

        bytes32 recordId = registry.publishVerification(
            CHAIN_ID,
            TARGET,
            BLOCK_NUM,
            POLICY_HASH,
            REPORT_HASH,
            2 // PolicyMatched
        );

        require(recordId == expectedId, "recordId mismatch");
        require(registry.recordExists(recordId), "record should exist");
        require(registry.totalRecords() == 1, "totalRecords should be 1");

        ShomerVerificationRegistry.VerificationRecord memory rec = registry.getRecord(recordId);
        require(rec.publisher == address(this), "publisher mismatch");
        require(rec.inspectedChain == CHAIN_ID, "chain mismatch");
        require(rec.targetContract == TARGET, "target mismatch");
        require(rec.inspectedBlock == BLOCK_NUM, "block mismatch");
        require(rec.policyHash == POLICY_HASH, "policyHash mismatch");
        require(rec.reportHash == REPORT_HASH, "reportHash mismatch");
        require(rec.verdict == 2, "verdict mismatch");
        require(rec.publishedAt == block.timestamp, "publishedAt mismatch");

        bytes32[] memory targetRecs = registry.getTargetRecords(CHAIN_ID, TARGET);
        require(targetRecs.length == 1, "targetRecords length should be 1");
        require(targetRecs[0] == recordId, "targetRecord id mismatch");

        bytes32[] memory pubRecs = registry.getPublisherRecords(address(this));
        require(pubRecs.length == 1, "publisherRecords length should be 1");
        require(pubRecs[0] == recordId, "publisherRecord id mismatch");
    }

    function testRejectDuplicate() public {
        registry.publishVerification(
            CHAIN_ID,
            TARGET,
            BLOCK_NUM,
            POLICY_HASH,
            REPORT_HASH,
            2
        );

        // Second identical publish must revert
        try registry.publishVerification(
            CHAIN_ID,
            TARGET,
            BLOCK_NUM,
            POLICY_HASH,
            REPORT_HASH,
            2
        ) {
            revert("Expected duplicate publication to revert");
        } catch {
            // Success: reverted
        }
    }

    function testRejectZeroTargetContract() public {
        try registry.publishVerification(
            CHAIN_ID,
            address(0),
            BLOCK_NUM,
            POLICY_HASH,
            REPORT_HASH,
            2
        ) {
            revert("Expected zero target address to revert");
        } catch {
            // Success
        }
    }

    function testRejectZeroInspectedChain() public {
        try registry.publishVerification(
            0,
            TARGET,
            BLOCK_NUM,
            POLICY_HASH,
            REPORT_HASH,
            2
        ) {
            revert("Expected zero chain ID to revert");
        } catch {
            // Success
        }
    }

    function testRejectZeroInspectedBlock() public {
        try registry.publishVerification(
            CHAIN_ID,
            TARGET,
            0,
            POLICY_HASH,
            REPORT_HASH,
            2
        ) {
            revert("Expected zero block to revert");
        } catch {
            // Success
        }
    }

    function testRejectEmptyPolicyHash() public {
        try registry.publishVerification(
            CHAIN_ID,
            TARGET,
            BLOCK_NUM,
            bytes32(0),
            REPORT_HASH,
            2
        ) {
            revert("Expected empty policy hash to revert");
        } catch {
            // Success
        }
    }

    function testRejectEmptyReportHash() public {
        try registry.publishVerification(
            CHAIN_ID,
            TARGET,
            BLOCK_NUM,
            POLICY_HASH,
            bytes32(0),
            2
        ) {
            revert("Expected empty report hash to revert");
        } catch {
            // Success
        }
    }

    function testRejectInvalidVerdict() public {
        try registry.publishVerification(
            CHAIN_ID,
            TARGET,
            BLOCK_NUM,
            POLICY_HASH,
            REPORT_HASH,
            3 // > 2
        ) {
            revert("Expected invalid verdict to revert");
        } catch {
            // Success
        }
    }
}
