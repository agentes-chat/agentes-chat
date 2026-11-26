import { useMe } from "@agenteschat/client";
import { membershipIn, settingUp } from "@agenteschat/client/lib/guards";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { requireUserIn } from "@/app/guards";
import { useServerLocale } from "@/i18n";
import { MemberOnboardingPage } from "@/pages/MemberOnboardingPage";

/**
 * `/welcome/$orgId`: the onboarding of someone who joined that workspace (ADR 0253, addendum of 2026-11-26), a page of
 * its own outside the workspace's shell, as `/onboarding` is. Someone who isn't a member gets the workspace's own
 * answer; an owner still setting it up, the onboarding.
 */
export const Route = createFileRoute("/welcome/$orgId")({
  beforeLoad: async ({ context, location, params }) => {
    const me = await requireUserIn(context, location.href, params.orgId);
    const membership = membershipIn(me, params.orgId);
    if (!membership) throw redirect({ to: "/org/$orgId", params: { orgId: params.orgId } });
    if (settingUp(membership)) throw redirect({ to: "/onboarding" });
  },
  component: function Welcome() {
    const { orgId } = Route.useParams();
    useServerLocale(useMe().data?.user);
    return <MemberOnboardingPage orgId={orgId} />;
  },
});
