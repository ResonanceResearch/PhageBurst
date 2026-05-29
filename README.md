# Phage One-Step Growth Dashboard

A static GitHub Pages dashboard for exploring one-step growth experiments used to estimate phage latent period and burst size. It models the experiment in which a bacterial culture is mixed with phage, incubated for adsorption, optionally treated with virucide to remove unbound phage, and then sampled over time for double agar plaque assays.

The dashboard is intentionally self-contained: it uses plain HTML, CSS, and JavaScript, with no build step and no external JavaScript dependencies.

## What it does

The dashboard lets you change:

- culture volume
- OD600 and the OD-to-cells/mL conversion
- susceptible fraction of the bacterial population
- phage dose, either by MOI or by total PFU added
- phage stock titer
- adsorption time
- adsorption rate constant
- virucide on/off and residual free-phage survival
- burst size
- burst time / latent period
- graph duration
- sample time, plating volume, and sample dilution

It displays:

- predicted PFU/mL over time on a log-scale one-step growth curve
- a clickable/drag-selectable sample time on the graph
- a simulated double agar plate preview at the selected time and dilution
- expected plaque count and countability warning
- experiment summary metrics
- CSV export for the modelled time series
- parameter-summary copy button

## Model overview

The model is designed as an interactive teaching and planning tool, not as a publication-grade inference engine. It assumes a single-step growth experiment in which secondary infections are suppressed after the adsorption/virucide step.

Initial bacteria:

```text
B_total = culture_volume_mL × cells_per_mL
S = susceptible_fraction × cells_per_mL
```

Phage dose:

```text
P0_per_mL = total_PFU_added / culture_volume_mL
MOI_total = total_PFU_added / B_total
MOI_susceptible = total_PFU_added / (susceptible_fraction × B_total)
```

Adsorption follows a simple mass-action loss of free phage:

```text
fraction_adsorbed = 1 - exp(-k × S × adsorption_time)
```

Productively infected cells follow a Poisson occupancy model so that multiple adsorptions to one bacterium do not create multiple burst events:

```text
infected_cells_per_mL = S × (1 - exp(-adsorbed_phage_per_mL / S))
```

Virucide is modeled as reducing only free, unadsorbed phage after the adsorption period. Infected cells are not killed by virucide.

Burst time is treated as the first-release latent period. Release is smoothed over a short rise period so the curve resembles experimental one-step growth data rather than an ideal step function.

Expected plaque count is calculated from the selected sample time:

```text
expected_plaques = PFU_per_mL × dilution_factor × plated_volume_mL
```

The plate preview uses this expected count to generate a deterministic pseudo-random plate image. It caps very high counts visually and labels plates as below counting range, countable, TNTC, or confluent.

## Suggested starting presets

The **Mcgavigan-like** preset uses parameters inspired by a mycobacteriophage one-step growth curve: low MOI, approximately 3-hour latent period, and a burst size near 200 PFU per infected cell. The bacterial concentration in that preset uses a lower OD-to-CFU conversion because the Mcgavigan paper reported OD600 0.2–0.25 as approximately 3–4 × 10^6 CFU/mL for its specific M. smegmatis conditions, whereas the default dashboard starts from the user's stated 10^8 bacteria/mL at OD600 0.25.

## Running locally

Open `index.html` directly in a browser.

For a local web server, from the repository folder run:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Publishing on GitHub Pages

1. Create a new GitHub repository.
2. Upload the contents of this folder to the repository root.
3. In GitHub, go to **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the `main` branch and `/root` folder.
6. Save. GitHub will publish the dashboard at the Pages URL shown in that settings page.

The `.nojekyll` file is included so GitHub Pages serves the static files exactly as provided.

## Repository structure

```text
phage-burst-dashboard/
├── index.html
├── README.md
├── .nojekyll
└── src/
    ├── app.js
    └── styles.css
```

## Limitations worth keeping in mind

- The adsorption constant is an adjustable assumption; real adsorption can deviate from simple mass-action behaviour.
- Resistant or non-susceptible bacteria are treated as nonproductive targets, not as adsorbing sinks.
- Secondary infection after release is intentionally suppressed to mimic one-step growth design.
- Burst-time heterogeneity is represented as a smooth rise period, not as a fitted latent-period distribution.
- The plate preview is a visual planning aid and not a replacement for stochastic plaque-count simulations with replicate plates.
