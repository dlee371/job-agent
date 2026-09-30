// Technology names the "job-only term" check looks for. If a term appears in the job posting
// and in the tailored resume but NOWHERE in your profile, it was probably copied from the job:
// the most common way a tailored resume ends up claiming something you haven't done.
//
// Single letters and ordinary words that double as tech names (C, R, Go, Swift…) are left out
// to avoid false alarms. Add terms from your field as you see them in job posts.
export const TECH_TERMS = [
  // languages
  "JavaScript", "TypeScript", "Python", "Java", "Kotlin", "Scala", "Ruby", "PHP", "C++", "C#", "Rust",
  "Golang", "Elixir", "Haskell", "Perl", "Dart", "Objective-C", "MATLAB", "Julia", "Bash", "PowerShell",
  "SQL", "NoSQL", "GraphQL", "HTML", "CSS", "Sass",
  // frontend
  "React", "React Native", "Next.js", "Vue", "Vue.js", "Nuxt", "Angular", "Svelte", "SvelteKit", "Redux",
  "Tailwind", "Tailwind CSS", "Bootstrap", "jQuery", "Webpack", "Vite", "Storybook", "Flutter",
  // backend
  "Node.js", "Express", "NestJS", "Django", "Flask", "FastAPI", "Spring", "Spring Boot", "Rails",
  "Ruby on Rails", "Laravel", ".NET", "ASP.NET", "gRPC", "REST", "RESTful", "Microservices", "Kafka",
  "RabbitMQ", "Celery", "WebSockets",
  // data
  "PostgreSQL", "Postgres", "MySQL", "SQLite", "MongoDB", "Redis", "DynamoDB", "Cassandra", "Elasticsearch",
  "Snowflake", "BigQuery", "Redshift", "Databricks", "Spark", "PySpark", "Hadoop", "Airflow", "dbt",
  "Pandas", "NumPy", "SciPy", "scikit-learn", "TensorFlow", "PyTorch", "Keras", "Jupyter", "Tableau",
  "Power BI", "Looker", "Excel", "ETL", "Supabase", "Firebase", "Prisma",
  // cloud & ops
  "AWS", "Azure", "GCP", "Google Cloud", "Lambda", "EC2", "S3", "CloudFormation", "Terraform", "Ansible",
  "Docker", "Kubernetes", "Helm", "Jenkins", "GitHub Actions", "GitLab CI", "CircleCI", "CI/CD",
  "Linux", "Nginx", "Datadog", "Grafana", "Prometheus", "Vercel", "Heroku", "Netlify",
  // testing & tools
  "Jest", "Vitest", "Mocha", "Cypress", "Playwright", "Selenium", "Pytest", "JUnit", "Git", "Jira",
  "Figma", "Postman", "OAuth", "JWT",
  // AI
  "LLM", "OpenAI", "LangChain", "RAG", "NLP", "Computer Vision", "Machine Learning", "Deep Learning",
];
