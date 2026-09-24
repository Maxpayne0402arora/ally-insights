export type Sku = {
  sku_id: string;
  is_client: boolean;
  competitor_group: string;
  brand: string;
  category: string;
  title: string;
  bullets: string[];
  description: string;
  image_urls: string[];
};

export type Severity = "high" | "medium" | "low";

export type Finding = {
  id: string;
  rule_id: string;
  field: string; // title | bullet_n | description | images
  severity: Severity;
  message: string;
  evidence: string;
};

export type DataSource = "sample" | "upload" | null;
