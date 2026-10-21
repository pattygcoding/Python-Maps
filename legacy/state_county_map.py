import geopandas as gpd
import matplotlib.pyplot as plt

# Load a shapefile of US counties
url = 'https://www2.census.gov/geo/tiger/GENZ2021/shp/cb_2021_us_county_500k.zip'
gdf = gpd.read_file(url)

# Filter for South Carolina counties (FIPS code for South Carolina is 45)
sc_counties = gdf[gdf['STATEFP'] == '45']

# List of upstate counties to shade in red
upstate_counties = [
    'Abbeville', 'Anderson', 'Cherokee', 'Greenville', 
    'Greenwood', 'Laurens', 'Oconee', 'Pickens', 
    'Spartanburg', 'Union'
]

# Mark those counties to shade in red
sc_counties['color'] = sc_counties['NAME'].apply(lambda x: 'red' if x in upstate_counties else 'lightgray')

# Plot South Carolina counties with the upstate ones shaded red
fig, ax = plt.subplots(1, 1, figsize=(10, 10))
sc_counties.plot(ax=ax, color=sc_counties['color'], edgecolor='black')

for idx, row in sc_counties.iterrows():
    plt.annotate(text=row['NAME'], xy=(row.geometry.centroid.x, row.geometry.centroid.y),
                 ha='center', fontsize=6, color='black')

# Add a title and show the plot
plt.title("Upstate South Carolina Counties - Selected Counties Shaded Red", fontsize=15)
plt.axis('off')  # Hide axes
plt.show()
