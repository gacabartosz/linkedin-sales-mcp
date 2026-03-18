/**
 * LinkedIn Sales Intelligence — 16 read-only MCP tools for Mike.
 */

import { z } from "zod";
import { log } from "./utils/logger.js";
import { toolError, toolResult } from "./utils/errors.js";
import { loadScraperAuth, saveScraperAuth, getRateLimitStats, COMPLIANCE_DISCLAIMER } from "./scraper/voyager.js";
import { searchPeople, searchCompanies, getCompanyPeople, extractCompanyId } from "./scraper/search.js";
import { getPersonPosts, getPersonComments, extractPublicId } from "./scraper/activity.js";
import { addCompany, listCompanies, removeCompany, addProspect, listProspects, getProspect, removeProspect, updateProspectScanTime, addActivity, getNewActivities, markActivitiesReviewed, getStats } from "./scraper/store.js";
import { classifyIntent } from "./scraper/classify.js";

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const ScraperAuthInput = z.object({
  li_at: z.string().describe("Your LinkedIn li_at session cookie from browser DevTools"),
});

const SearchPeopleInput = z.object({
  keywords: z.string().optional().describe("Search keywords (e.g., 'e-commerce manager')"),
  title: z.string().optional().describe("Job title filter"),
  company_id: z.string().optional().describe("LinkedIn company ID or universal name"),
  location: z.string().optional().describe("Location: 'poland', 'warsaw', 'europe', etc."),
  count: z.number().int().min(1).max(25).optional(),
  start: z.number().int().min(0).optional(),
});

const SearchCompaniesInput = z.object({
  keywords: z.string().describe("Company name or keywords"),
  count: z.number().int().min(1).max(25).optional(),
  start: z.number().int().min(0).optional(),
});

const CompanyPeopleInput = z.object({
  company: z.string().describe("Company URL or ID"),
  role_keywords: z.string().optional().describe("Filter by role (e.g., 'sales growth')"),
  count: z.number().int().min(1).max(25).optional(),
  start: z.number().int().min(0).optional(),
});

const PersonActivityInput = z.object({
  profile: z.string().describe("Profile URL or public ID"),
  type: z.enum(["posts", "comments", "all"]).optional(),
  count: z.number().int().min(1).max(20).optional(),
  start: z.number().int().min(0).optional(),
});

const IntentClassifyInput = z.object({
  text: z.string().describe("Text to classify"),
  person_name: z.string().optional(),
  person_headline: z.string().optional(),
  activity_type: z.enum(["post", "comment"]).optional(),
  original_post: z.string().optional(),
});

const ProspectSaveInput = z.object({
  name: z.string(),
  public_id: z.string(),
  headline: z.string().optional(),
  profile_url: z.string().optional(),
  company_name: z.string().optional(),
  category: z.enum(["competitor_sales", "target_buyer", "influencer", "other"]).optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  source_company_id: z.string().optional(),
});

const ProspectListInput = z.object({
  category: z.enum(["competitor_sales", "target_buyer", "influencer", "other"]).optional(),
  source_company_id: z.string().optional(),
  has_new_activity: z.boolean().optional(),
});

const CompanySaveInput = z.object({
  name: z.string(),
  company: z.string(),
  type: z.enum(["direct_competitor", "indirect_competitor", "target_segment", "other"]).optional(),
  notes: z.string().optional(),
});

const ProspectScanInput = z.object({
  prospect_id: z.string().optional(),
  category: z.enum(["competitor_sales", "target_buyer", "influencer", "other"]).optional(),
  classify: z.boolean().optional(),
});

const ActivitiesListInput = z.object({
  classification: z.enum(["sales_pitch", "buying_signal", "job_posting", "networking", "irrelevant"]).optional(),
  prospect_id: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  mark_reviewed: z.boolean().optional(),
});

// ── Tool Definitions ─────────────────────────────────────────────────────────

export const toolDefinitions = [
  {
    name: "linkedin_scraper_auth",
    description: "Set LinkedIn session cookie for search & monitoring. Get li_at from browser DevTools → Application → Cookies → linkedin.com. Rate limited: 30/hr, 150/day.",
    inputSchema: { type: "object" as const, properties: { li_at: { type: "string" as const, description: "li_at cookie value" } }, required: ["li_at"] },
  },
  {
    name: "linkedin_search_people",
    description: "Search LinkedIn for people by keywords, title, company, location. Use to find competitor salespeople or target buyers (e-commerce managers).",
    inputSchema: { type: "object" as const, properties: {
      keywords: { type: "string" as const, description: "Search keywords" },
      title: { type: "string" as const, description: "Job title filter" },
      company_id: { type: "string" as const, description: "Company ID" },
      location: { type: "string" as const, description: "Location (poland, warsaw, etc.)" },
      count: { type: "number" as const }, start: { type: "number" as const },
    }},
  },
  {
    name: "linkedin_search_companies",
    description: "Search for companies on LinkedIn by name or keywords.",
    inputSchema: { type: "object" as const, properties: {
      keywords: { type: "string" as const, description: "Company name or keywords" },
      count: { type: "number" as const }, start: { type: "number" as const },
    }, required: ["keywords"] },
  },
  {
    name: "linkedin_company_people",
    description: "List people at a company, filtered by role. Great for finding competitor salespeople (search: 'sales growth business development').",
    inputSchema: { type: "object" as const, properties: {
      company: { type: "string" as const, description: "Company URL or ID" },
      role_keywords: { type: "string" as const, description: "Role filter" },
      count: { type: "number" as const }, start: { type: "number" as const },
    }, required: ["company"] },
  },
  {
    name: "linkedin_person_activity",
    description: "Get a person's recent LinkedIn activity (posts, comments, shares). Monitor competitor sales COMMENTS for RFP pitches, and target buyer POSTS for buying intent.",
    inputSchema: { type: "object" as const, properties: {
      profile: { type: "string" as const, description: "Profile URL or public ID" },
      type: { type: "string" as const, enum: ["posts", "comments", "all"], description: "Activity type" },
      count: { type: "number" as const }, start: { type: "number" as const },
    }, required: ["profile"] },
  },
  {
    name: "linkedin_intent_classify",
    description: "AI classification of LinkedIn text. Categories: sales_pitch (competitor offering services), buying_signal (seeking vendor), job_posting (hiring = growth), networking, irrelevant.",
    inputSchema: { type: "object" as const, properties: {
      text: { type: "string" as const, description: "Text to classify" },
      person_name: { type: "string" as const }, person_headline: { type: "string" as const },
      activity_type: { type: "string" as const, enum: ["post", "comment"] },
      original_post: { type: "string" as const },
    }, required: ["text"] },
  },
  {
    name: "linkedin_prospect_save",
    description: "Save person to monitoring database. Categories: competitor_sales (monitor COMMENTS), target_buyer (monitor POSTS), influencer, other.",
    inputSchema: { type: "object" as const, properties: {
      name: { type: "string" as const }, public_id: { type: "string" as const },
      headline: { type: "string" as const }, company_name: { type: "string" as const },
      category: { type: "string" as const, enum: ["competitor_sales", "target_buyer", "influencer", "other"] },
      tags: { type: "array" as const, items: { type: "string" as const } },
      notes: { type: "string" as const }, source_company_id: { type: "string" as const },
    }, required: ["name", "public_id"] },
  },
  {
    name: "linkedin_prospect_list",
    description: "List saved prospects with filters.",
    inputSchema: { type: "object" as const, properties: {
      category: { type: "string" as const, enum: ["competitor_sales", "target_buyer", "influencer", "other"] },
      source_company_id: { type: "string" as const },
      has_new_activity: { type: "boolean" as const },
    }},
  },
  {
    name: "linkedin_company_save",
    description: "Add company to monitoring list. Types: direct_competitor, indirect_competitor, target_segment.",
    inputSchema: { type: "object" as const, properties: {
      name: { type: "string" as const }, company: { type: "string" as const },
      type: { type: "string" as const, enum: ["direct_competitor", "indirect_competitor", "target_segment", "other"] },
      notes: { type: "string" as const },
    }, required: ["name", "company"] },
  },
  {
    name: "linkedin_company_list",
    description: "List all monitored companies.",
    inputSchema: { type: "object" as const, properties: {
      type: { type: "string" as const, enum: ["direct_competitor", "indirect_competitor", "target_segment", "other"] },
    }},
  },
  {
    name: "linkedin_prospect_scan",
    description: "Scan prospects for new activity + AI classify. Fetches COMMENTS for competitor_sales, POSTS for target_buyers. Rate limited.",
    inputSchema: { type: "object" as const, properties: {
      prospect_id: { type: "string" as const, description: "Specific prospect public_id (omit = scan all)" },
      category: { type: "string" as const, enum: ["competitor_sales", "target_buyer", "influencer", "other"] },
      classify: { type: "boolean" as const, description: "Run AI classification (default: true)" },
    }},
  },
  {
    name: "linkedin_activities_feed",
    description: "Get classified activities feed — buying signals, sales pitches, job postings detected by monitoring. Filter by type, mark as reviewed.",
    inputSchema: { type: "object" as const, properties: {
      classification: { type: "string" as const, enum: ["sales_pitch", "buying_signal", "job_posting", "networking", "irrelevant"] },
      prospect_id: { type: "string" as const },
      limit: { type: "number" as const },
      mark_reviewed: { type: "boolean" as const },
    }},
  },
  {
    name: "linkedin_monitor_stats",
    description: "Get monitoring system statistics — prospects, companies, activities, classification breakdown.",
    inputSchema: { type: "object" as const, properties: {} },
  },
];

// ── Tool Handler ──────────────────────────────────────────────────────────────

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    switch (name) {
      case "linkedin_scraper_auth": {
        const input = ScraperAuthInput.parse(args);
        saveScraperAuth({ li_at: input.li_at, tos_acknowledged: true } as Parameters<typeof saveScraperAuth>[0]);
        return toolResult({
          authenticated: true,
          disclaimer: COMPLIANCE_DISCLAIMER,
          message: "Auth saved. You can now search, monitor, and classify.",
          rate_limit: getRateLimitStats(),
        });
      }

      case "linkedin_search_people": {
        const input = SearchPeopleInput.parse(args);
        const result = await searchPeople(input);
        return toolResult({ ...result, rate_limit: getRateLimitStats() });
      }

      case "linkedin_search_companies": {
        const input = SearchCompaniesInput.parse(args);
        const result = await searchCompanies(input);
        return toolResult({ ...result, rate_limit: getRateLimitStats() });
      }

      case "linkedin_company_people": {
        const input = CompanyPeopleInput.parse(args);
        const companyId = extractCompanyId(input.company);
        const result = await getCompanyPeople({ company_id: companyId, role_keywords: input.role_keywords, count: input.count, start: input.start });
        return toolResult({ ...result, rate_limit: getRateLimitStats() });
      }

      case "linkedin_person_activity": {
        const input = PersonActivityInput.parse(args);
        const publicId = extractPublicId(input.profile);
        const actType = input.type || "all";
        const result = actType === "comments"
          ? await getPersonComments({ public_id: publicId, count: input.count, start: input.start })
          : await getPersonPosts({ public_id: publicId, count: input.count, start: input.start });
        return toolResult({ profile: publicId, activity_type: actType, ...result, rate_limit: getRateLimitStats() });
      }

      case "linkedin_intent_classify": {
        const input = IntentClassifyInput.parse(args);
        const result = await classifyIntent(input.text, {
          person_name: input.person_name,
          person_headline: input.person_headline,
          activity_type: input.activity_type,
          original_post: input.original_post,
        });
        return toolResult(result);
      }

      case "linkedin_prospect_save": {
        const input = ProspectSaveInput.parse(args);
        const prospect = addProspect(input);
        return toolResult({ saved: true, prospect });
      }

      case "linkedin_prospect_list": {
        const input = ProspectListInput.parse(args);
        const prospects = listProspects(input);
        return toolResult({ prospects, total: prospects.length });
      }

      case "linkedin_company_save": {
        const input = CompanySaveInput.parse(args);
        const companyId = extractCompanyId(input.company);
        const company = addCompany({
          name: input.name,
          company_id: companyId,
          company_url: input.company.includes("linkedin.com") ? input.company : `https://www.linkedin.com/company/${companyId}`,
          type: input.type,
          notes: input.notes,
        });
        return toolResult({ saved: true, company });
      }

      case "linkedin_company_list": {
        const typeFilter = args.type as string | undefined;
        const companies = listCompanies(typeFilter);
        return toolResult({ companies, total: companies.length });
      }

      case "linkedin_prospect_scan": {
        const input = ProspectScanInput.parse(args);
        const shouldClassify = input.classify !== false;
        let prospects;
        if (input.prospect_id) {
          const p = getProspect(input.prospect_id);
          prospects = p ? [p] : [];
        } else {
          prospects = listProspects({ category: input.category });
        }
        if (!prospects.length) return toolResult({ message: "No prospects to scan.", scanned: 0 });

        const scanResults: Array<{ prospect_name: string; public_id: string; new_activities: number; actionable: number }> = [];
        for (const prospect of prospects) {
          try {
            const isSales = prospect.category === "competitor_sales";
            const activityResult = isSales
              ? await getPersonComments({ public_id: prospect.public_id, count: 10 })
              : await getPersonPosts({ public_id: prospect.public_id, count: 10 });
            let newCount = 0, actionableCount = 0;
            for (const activity of activityResult.activities) {
              if (!activity.text) continue;
              let classification = "irrelevant", confidence = 0, reasoning = "";
              if (shouldClassify) {
                const c = await classifyIntent(activity.text, { person_name: prospect.name, person_headline: prospect.headline, activity_type: activity.type, original_post: activity.original_post_text });
                classification = c.classification; confidence = c.confidence; reasoning = c.reasoning;
                if (c.is_actionable) actionableCount++;
              }
              addActivity({ prospect_id: prospect.id, type: activity.type, text: activity.text, post_url: activity.post_url, post_urn: activity.post_urn || "", date: activity.date, classification, confidence, reasoning });
              newCount++;
            }
            updateProspectScanTime(prospect.public_id);
            scanResults.push({ prospect_name: prospect.name, public_id: prospect.public_id, new_activities: newCount, actionable: actionableCount });
          } catch (err) {
            log("warn", `Scan failed for ${prospect.name}: ${(err as Error).message}`);
            scanResults.push({ prospect_name: prospect.name, public_id: prospect.public_id, new_activities: 0, actionable: 0 });
          }
        }
        return toolResult({ scanned: scanResults.length, total_new_activities: scanResults.reduce((s, r) => s + r.new_activities, 0), total_actionable: scanResults.reduce((s, r) => s + r.actionable, 0), results: scanResults, rate_limit: getRateLimitStats() });
      }

      case "linkedin_activities_feed": {
        const input = ActivitiesListInput.parse(args);
        const activities = getNewActivities({ classification: input.classification, prospect_id: input.prospect_id, limit: input.limit });
        const enriched = activities.map((a) => {
          const p = getProspect(a.prospect_id);
          return { ...a, prospect_name: p?.name, prospect_headline: p?.headline, prospect_category: p?.category, prospect_company: p?.company_name };
        });
        if (input.mark_reviewed && activities.length > 0) markActivitiesReviewed(activities.map((a) => a.id));
        return toolResult({ activities: enriched, total: enriched.length });
      }

      case "linkedin_monitor_stats": {
        const stats = getStats();
        const auth = loadScraperAuth();
        return toolResult({ ...stats, scraper_authenticated: !!auth?.li_at, rate_limit: getRateLimitStats() });
      }

      default:
        return toolError(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("error", `Tool ${name} failed`, message);
    return toolError(message);
  }
}
