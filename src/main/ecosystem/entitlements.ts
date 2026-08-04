/**
 * Marketplace entitlement gate for paid Discover packages.
 */

import type { RegistryItem } from "../../shared/registry";
import { getAccount, findAccountProfile } from "../account-store";

export interface EntitlementCheck {
  allowed: boolean;
  pricingModel?: string;
  reason?: string;
}

function catalogBaseUrl(): string {
  return (
    process.env.HERMES_CATALOG_BASE_URL?.trim() ||
    process.env.MAIN_VITE_HERMES_CATALOG_BASE_URL?.trim() ||
    ""
  ).replace(/\/$/, "");
}

export function resolveAccountId(profile?: string): string {
  const linked = findAccountProfile();
  const account =
    getAccount(profile) || (linked ? getAccount(linked) : null);
  return account?.user?.id?.trim() || process.env.HERMES_ACCOUNT_ID?.trim() || "";
}

/**
 * Free / missing pricing → allow. Paid packages require marketplace check when
 * HERMES_CATALOG_BASE_URL is set. Local-link installs skip the gate.
 */
// @lat: [[lat.md/ecosystem#Hermes ecosystem#Entitlements]]
export async function checkInstallEntitlement(
  item: RegistryItem,
  opts: { accountId?: string; localLink?: boolean; profile?: string } = {},
): Promise<EntitlementCheck> {
  if (opts.localLink || item.localPath?.trim()) {
    return { allowed: true, pricingModel: "local" };
  }

  const model = item.pricing?.model || "free";
  if (model === "free") {
    return { allowed: true, pricingModel: "free" };
  }

  const base = catalogBaseUrl();
  if (!base) {
    return {
      allowed: true,
      pricingModel: model,
      reason: "Marketplace not configured; paid check skipped",
    };
  }

  const accountId =
    opts.accountId?.trim() || resolveAccountId(opts.profile);

  try {
    const url = new URL(`${base}/v1/entitlements/check`);
    url.searchParams.set("packageId", item.id);
    if (accountId) url.searchParams.set("accountId", accountId);
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return {
        allowed: false,
        pricingModel: model,
        reason: `Entitlement check failed (${res.status})`,
      };
    }
    const data = (await res.json()) as EntitlementCheck;
    return {
      allowed: !!data.allowed,
      pricingModel: data.pricingModel || model,
      reason: data.reason,
    };
  } catch (err) {
    return {
      allowed: false,
      pricingModel: model,
      reason:
        err instanceof Error
          ? err.message
          : "Entitlement check network error",
    };
  }
}

export interface PurchaseResult {
  success: boolean;
  error?: string;
  checkoutId?: string;
  code?: "needs_sign_in" | "checkout_failed";
}

/**
 * Stub checkout: create session then immediately complete to grant entitlement.
 */
// @lat: [[lat.md/ecosystem#Hermes ecosystem#Entitlements#Checkout]]
export async function purchaseRegistryItem(
  item: RegistryItem,
  opts: { profile?: string; accountId?: string } = {},
): Promise<PurchaseResult> {
  const model = item.pricing?.model || "free";
  if (model === "free") return { success: true };

  const base = catalogBaseUrl();
  if (!base) {
    return { success: true };
  }

  const accountId =
    opts.accountId?.trim() || resolveAccountId(opts.profile);
  if (!accountId) {
    return {
      success: false,
      code: "needs_sign_in",
      error: "Sign in to purchase paid packages",
    };
  }

  try {
    const createRes = await fetch(`${base}/v1/checkout`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ packageId: item.id, accountId }),
    });
    if (!createRes.ok) {
      const body = (await createRes.json().catch(() => ({}))) as {
        error?: string;
      };
      return {
        success: false,
        code: "checkout_failed",
        error: body.error || `Checkout failed (${createRes.status})`,
      };
    }
    const checkout = (await createRes.json()) as { id: string };
    const completeRes = await fetch(
      `${base}/v1/checkout/${encodeURIComponent(checkout.id)}/complete`,
      {
        method: "POST",
        headers: { Accept: "application/json" },
      },
    );
    if (!completeRes.ok) {
      const body = (await completeRes.json().catch(() => ({}))) as {
        error?: string;
      };
      return {
        success: false,
        code: "checkout_failed",
        error: body.error || `Payment complete failed (${completeRes.status})`,
        checkoutId: checkout.id,
      };
    }
    return { success: true, checkoutId: checkout.id };
  } catch (err) {
    return {
      success: false,
      code: "checkout_failed",
      error: err instanceof Error ? err.message : "Checkout network error",
    };
  }
}
