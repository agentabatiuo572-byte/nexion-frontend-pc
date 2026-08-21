export function developerAccessResourceGuard(status: string | undefined) {
  return {
    canApprove: status === "PENDING",
    canReject: status === "PENDING",
    canRevoke: status === "APPROVED",
  };
}

export function canReviewDeveloperAccess(status: string | undefined, action: "approve" | "reject" | "revoke") {
  const guard = developerAccessResourceGuard(status);
  return action === "approve" ? guard.canApprove : action === "reject" ? guard.canReject : guard.canRevoke;
}
